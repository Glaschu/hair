import { testDb, wipe, closeDb } from './src/testDb.mjs';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  version, viewLink, book, cancel, previewCancel, createLink, tierFor,
} from './src/bookingApi.mjs';

/** Shaped like the booking page's sealed box; its contents are only ever opened on her devices. */
const ENVELOPE = Buffer.alloc(120, 7).toString('base64');

/**
 * The Firebase half of the two deployments, against a real database.
 *
 * The Cloudflare Worker serves the same four routes from D1 and has its own 54
 * tests. These are not a copy of those: they check the things that are
 * different *because* it is Firestore — chiefly that a slot claim, the link's
 * count and the booking are one transaction rather than several statements
 * someone has to remember to keep together.
 */

let db, app;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;
const iso = (offsetH) => new Date(NOW + h(offsetH)).toISOString();

before(() => { ({ db, app } = testDb('iris-bookingapi-test')); });
after(async () => { await closeDb(app); });

beforeEach(async () => {
  await wipe(db);
  for (const name of ['links', 'salon', 'policies']) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await db.doc('salon/me').set({ name: 'Iris', publicKey: 'pk-base64' });
});

const mint = (over = {}) => createLink(db, {
  clientRef: 'ref-1', serviceName: 'Full head colour', priceMinor: 9000,
  slots: [{ startsAt: iso(50), endsAt: iso(53) }], ...over,
}, { now: NOW });

const takeIt = async (token, over = {}) => {
  const view = await viewLink(db, token, NOW);
  return book(db, token, {
    slotId: view.body.slots[0].id, sealed: ENVELOPE, agreed: true, ...over,
  }, { now: NOW });
};

describe('what a deployment says it can do', () => {
  test('no Stripe key, no deposits — and the app is told rather than guessing', () => {
    assert.ok(version({}).body.capabilities.includes('booking-links'));
    assert.ok(!version({}).body.capabilities.includes('deposits'));
    // The key alone is not enough: with no webhook secret the service could
    // take a deposit but never learn it was paid. That is what the live
    // service was advertising before this was tightened.
    assert.ok(!version({ STRIPE_SECRET_KEY: 'sk_test' }).body.capabilities.includes('deposits'));
    assert.ok(version({ STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_x' })
      .body.capabilities.includes('deposits'));
  });

  test('always reports live-sync, which is the reason to pick this deployment', () => {
    // The Cloudflare one cannot offer it at all; that difference is the whole
    // point of having two.
    assert.ok(version({}).body.capabilities.includes('live-sync'));
  });
});

describe('opening a link', () => {
  test('shows the times, the price and the zone they mean', async () => {
    const { body: made } = await mint();
    const { status, body } = await viewLink(db, made.token, NOW);

    assert.equal(status, 200);
    assert.equal(body.salonName, 'Iris');
    assert.equal(body.priceMinor, 9000);
    assert.equal(body.tz, 'Europe/London');
    assert.equal(body.slots.length, 1);
  });

  test('is gone once the salon is', async () => {
    // After a reset there is no key to seal to. Offering a form that produces
    // an unopenable envelope is worse than saying nothing.
    const { body: made } = await mint();
    await db.doc('salon/me').delete();
    assert.equal((await viewLink(db, made.token, NOW)).status, 404);
  });

  test('is gone once expired or revoked', async () => {
    const { body: made } = await mint();
    await db.doc(`links/${made.token}`).update({ revoked: true });
    assert.equal((await viewLink(db, made.token, NOW)).status, 404);
  });
});

describe('booking, in one transaction', () => {
  test('claims the slot, counts it and writes the booking together', async () => {
    const { body: made } = await mint();
    const { status, body } = await takeIt(made.token);
    assert.equal(status, 200);

    const link = (await db.doc(`links/${made.token}`).get()).data();
    assert.equal(link.bookedCount, 1);
    assert.equal(link.slots[0].taken, true);
    assert.equal((await db.doc(`bookings/${body.bookingId}`).get()).data().status, 'confirmed');
  });

  test('two people going for the same hour: exactly one gets it', async () => {
    // On the Worker this was two statements and a race. Here the database
    // refuses to let both happen.
    const { body: made } = await mint({ maxBookings: 5 });
    const view = await viewLink(db, made.token, NOW);
    const both = await Promise.all([
      book(db, made.token, { slotId: view.body.slots[0].id, sealed: ENVELOPE, agreed: true }, { now: NOW }),
      book(db, made.token, { slotId: view.body.slots[0].id, sealed: Buffer.alloc(120, 8).toString('base64'), agreed: true }, { now: NOW }),
    ]);

    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
    const count = (await db.collection('bookings').get()).size;
    assert.equal(count, 1, 'one booking, never two');
  });

  test('a retry after a lost response returns the same booking', async () => {
    const { body: made } = await mint({ maxBookings: 3 });
    const first = await takeIt(made.token, { requestId: 'req-1' });
    const view = await viewLink(db, made.token, NOW);
    const again = await book(db, made.token, {
      slotId: view.body.slots[0]?.id ?? 's0', sealed: ENVELOPE,
      agreed: true, requestId: 'req-1',
    }, { now: NOW });

    assert.equal(again.body.bookingId, first.body.bookingId);
    assert.equal(again.body.replayed, true);
    assert.equal((await db.collection('bookings').get()).size, 1);
  });

  test('a link is spent afterwards, so forwarding it takes nothing else', async () => {
    const { body: made } = await mint();
    await takeIt(made.token);
    assert.equal((await viewLink(db, made.token, NOW)).status, 404);
  });

  test('refuses without agreement, and leaves the hour free', async () => {
    // The policy comes from her salon record and is pinned when the link is
    // made — never from the request.
    await db.doc('salon/me').update({ policy: 'Give 48 hours notice.' });
    const { body: made } = await mint();
    const view = await viewLink(db, made.token, NOW);

    const out = await book(db, made.token,
      { slotId: view.body.slots[0].id, sealed: ENVELOPE }, { now: NOW });
    assert.equal(out.status, 422);

    const after = await viewLink(db, made.token, NOW);
    assert.equal(after.body.slots.length, 1, 'a refused booking consumes nothing');
  });

  test('refuses an envelope large enough to be free disk space', async () => {
    const { body: made } = await mint();
    const view = await viewLink(db, made.token, NOW);
    const out = await book(db, made.token,
      { slotId: view.body.slots[0].id, sealed: ENVELOPE.repeat(5000), agreed: true }, { now: NOW });
    assert.equal(out.status, 413);
  });
});

describe('cancelling', () => {
  test('puts the hour back on sale', async () => {
    const { body: made } = await mint({ maxBookings: 2 });
    const booked = await takeIt(made.token);

    assert.equal((await viewLink(db, made.token, NOW)).body.slots.length, 0);
    await cancel(db, booked.body.cancelToken, 'client', NOW);
    assert.equal((await viewLink(db, made.token, NOW)).body.slots.length, 1);
  });

  test('twice frees it once, and the tier does not drift', async () => {
    const { body: made } = await mint({ maxBookings: 2 });
    const booked = await takeIt(made.token);

    const first = await cancel(db, booked.body.cancelToken, 'client', NOW);
    const second = await cancel(db, booked.body.cancelToken, 'client', NOW + h(20));

    assert.equal(first.body.alreadyCancelled, false);
    assert.equal(second.body.alreadyCancelled, true);
    assert.equal(second.body.refundPct, first.body.refundPct);
    assert.equal((await db.doc(`links/${made.token}`).get()).data().bookedCount, 0);
  });

  test('tells her what it costs before she presses anything', async () => {
    // With her policy set, as the app does before the first link goes out.
    await db.doc('salon/me').update({ policy: 'Give 48 hours notice.' });
    const { body: made } = await mint({ slots: [{ startsAt: iso(6), endsAt: iso(8) }] });
    const booked = await takeIt(made.token);
    const preview = await previewCancel(db, booked.body.cancelToken, NOW);

    assert.equal(preview.body.status, 'confirmed');
    assert.equal(preview.body.refundPct, 0, 'inside 24 hours, told up front');
  });

  test('the tiers are her stated terms, from real hour offsets', () => {
    assert.equal(tierFor(h(72)), 100);
    assert.equal(tierFor(h(48.5)), 100);
    assert.equal(tierFor(h(47.5)), 50);
    assert.equal(tierFor(h(23)), 0);
  });
});

describe('minting a link', () => {
  test('refuses to offer an hour another live link already offers', async () => {
    await mint();
    const clash = await mint({ slots: [{ startsAt: iso(51), endsAt: iso(54) }] });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error, 'slot already offered');
  });

  test('back-to-back is fine — that is a real day', async () => {
    await mint();
    assert.equal((await mint({ slots: [{ startsAt: iso(53), endsAt: iso(55) }] })).status, 200);
  });

  test("a used-up link's other hours go back on offer — the booked one does not", async () => {
    // Offered three times, booked one: the other two used to stay blocked from
    // every other client until the link expired, three weeks later.
    const { body: made } = await mint({
      slots: [{ startsAt: iso(50), endsAt: iso(53) }, { startsAt: iso(60), endsAt: iso(63) }],
    });
    await takeIt(made.token);
    assert.equal((await mint({ slots: [{ startsAt: iso(60), endsAt: iso(63) }] })).status, 200);
    assert.equal((await mint({ slots: [{ startsAt: iso(50), endsAt: iso(53) }] })).status, 409,
      'the hour that was actually booked stays blocked');
  });

  test('refuses things that are plainly not a link', async () => {
    assert.equal((await mint({ priceMinor: 'ninety' })).status, 400);
    assert.equal((await mint({ clientRef: { not: 'a string' } })).status, 400);
    assert.equal((await mint({ serviceName: 'x'.repeat(500) })).status, 413);
  });

  test('a revoked link stops holding its hour', async () => {
    const { body: made } = await mint();
    await db.doc(`links/${made.token}`).update({ revoked: true });
    assert.equal((await mint()).status, 200);
  });

  test('refuses a backwards interval rather than storing nonsense', async () => {
    const out = await mint({ slots: [{ startsAt: iso(53), endsAt: iso(50) }] });
    assert.equal(out.status, 400);
  });
});
