import { testDb, wipe, closeDb } from './src/testDb.mjs';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startDeposit, releaseLapsedHolds, depositMinor, HOLD_SECONDS,
} from './src/deposit.mjs';

/** Shaped like the booking page's sealed box; its contents are only ever opened on her devices. */
const ENVELOPE = Buffer.alloc(120, 7).toString('base64');

/**
 * Taking a deposit — the point where a booking link becomes money, and where
 * the design has the most ways to go wrong quietly.
 *
 * Stripe is injected, so every awkward case can be built exactly: an account
 * that refuses, a slot taken while Stripe was answering, a checkout abandoned.
 */

let db, app;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;

before(() => { ({ db, app } = testDb('iris-deposit-test')); });
after(async () => { await closeDb(app); });

beforeEach(async () => {
  await wipe(db);
  for (const c of ['links', 'salon']) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  await db.doc('salon/me').set({ name: 'Iris', publicKey: 'pk' });
  await db.doc('links/tok1').set({
    clientRef: 'ref-1', serviceName: 'Full head colour', durationMins: 180,
    priceMinor: 9000, tz: 'Europe/London', policyId: null,
    createdAt: NOW, expiresAt: NOW + h(480), revoked: false,
    maxBookings: 1, bookedCount: 0,
    slots: [{ id: 's0', s: NOW + h(50), e: NOW + h(53), taken: false }],
  });
});

const fakeStripe = (over = {}) => ({
  calls: [],
  async createCheckoutSession(params) {
    this.calls.push(params);
    return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
  },
  ...over,
});

const start = (stripe, opts = {}) =>
  startDeposit(db, 'tok1', 's0', {
    stripe, now: NOW, origin: 'https://book.test', sealed: ENVELOPE, agreed: true, ...opts,
  });

describe('the amount', () => {
  test('is half, to the penny, and never a float', () => {
    assert.equal(depositMinor(9000), 4500);
    assert.equal(depositMinor(4995), 2498);
    assert.equal(Number.isInteger(depositMinor(4995)), true);
  });

  test('is computed from the stored price, not from anything sent in', async () => {
    // She may edit her price while a checkout is open. The figure frozen here
    // is the one confirmation compares against.
    const stripe = fakeStripe();
    const out = await start(stripe);
    assert.equal(out.body.depositMinor, 4500);
    assert.equal((await db.doc(`bookings/${out.body.bookingId}`).get()).data().expectedAmountMinor, 4500);
  });
});

describe('the session Stripe is asked for', () => {
  test('carries the booking id in both places the reconciler might look', async () => {
    // A session has client_reference_id; a PaymentIntent does not — and the
    // reconciler walks PaymentIntents. Verified against the live API in pass 8.
    const stripe = fakeStripe();
    const out = await start(stripe);
    const params = stripe.calls[0];
    assert.equal(params.client_reference_id, out.body.bookingId);
    assert.equal(params.payment_intent_data.metadata.iris_booking_id, out.body.bookingId);
  });

  test('never leaves the expiry to default', async () => {
    // Stripe's default is 24 hours, which would hold a Saturday morning until
    // Sunday. The floor is 30 minutes and that is what is asked for.
    const stripe = fakeStripe();
    await start(stripe);
    assert.equal(stripe.calls[0].expires_at, Math.floor(NOW / 1000) + HOLD_SECONDS);
  });

  test('is idempotent per booking, so a double tap is one session', async () => {
    const stripe = fakeStripe();
    const out = await start(stripe);
    assert.equal(stripe.calls[0].idempotency_key, `deposit:${out.body.bookingId}`);
  });

  test('sends the client to a URL that grants nothing on return', async () => {
    // Coming back from Stripe is navigation, not proof. Only the webhook
    // confirms — treating the redirect as evidence is the commonest way a
    // deposit is taken with no booking behind it.
    const stripe = fakeStripe();
    const out = await start(stripe);
    assert.match(stripe.calls[0].success_url, /\/b\/tok1/);
    assert.equal((await db.doc(`bookings/${out.body.bookingId}`).get()).data().status, 'pending_payment');
  });
});

describe('the hold', () => {
  test('is placed on the slot and expires with the session', async () => {
    const out = await start(fakeStripe());
    const slot = (await db.doc('links/tok1').get()).data().slots[0];
    assert.ok(slot.heldUntil > NOW);
    assert.equal(slot.taken, false, 'held is not taken — only a paid webhook takes it');
    assert.equal(out.body.holdExpiresAt, slot.heldUntil);
  });

  test('blocks a second person mid-checkout', async () => {
    await start(fakeStripe());
    assert.equal((await start(fakeStripe())).status, 409);
  });

  test('lapses by being read, not by a sweeper having run', async () => {
    // A sweeper outage must never be able to block a booking.
    await start(fakeStripe());
    const later = NOW + h(2);
    assert.equal((await start(fakeStripe(), { now: later })).status, 200);
  });

  test('the sweeper only tidies', async () => {
    await start(fakeStripe());
    assert.deepEqual(await releaseLapsedHolds(db, NOW + h(2)), { released: 1 });
    assert.equal((await db.doc('links/tok1').get()).data().slots[0].heldUntil, null);
    // Nothing left to do on a second run.
    assert.deepEqual(await releaseLapsedHolds(db, NOW + h(2)), { released: 0 });
  });

  test('a live hold is left alone by the sweeper', async () => {
    await start(fakeStripe());
    assert.deepEqual(await releaseLapsedHolds(db, NOW + 60_000), { released: 0 });
  });
});

describe('when things go wrong', () => {
  test('a service with no Stripe configured says so rather than failing oddly', async () => {
    const out = await startDeposit(db, 'tok1', 's0', {
      now: NOW, origin: 'https://book.test', sealed: ENVELOPE,
    });
    assert.equal(out.status, 501);
  });

  test('Stripe refusing costs no chair time', async () => {
    // The hold is written AFTER the session is created. The other order leaks a
    // hold on every failed attempt.
    const angry = fakeStripe({ createCheckoutSession: async () => { throw new Error('card_error'); } });
    assert.equal((await start(angry)).status, 502);
    const slot = (await db.doc('links/tok1').get()).data().slots[0];
    assert.equal(slot.heldUntil ?? null, null, 'the hour is still free');
  });

  test('a slot taken while Stripe was answering is not overwritten', async () => {
    const racer = fakeStripe({
      async createCheckoutSession(params) {
        this.calls.push(params);
        // Somebody books it in the moment Stripe takes to reply.
        const link = (await db.doc('links/tok1').get()).data();
        await db.doc('links/tok1').update({
          slots: link.slots.map((s) => ({ ...s, taken: true })),
        });
        return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
      },
    });
    await start(racer);
    const slot = (await db.doc('links/tok1').get()).data().slots[0];
    assert.equal(slot.taken, true);
    assert.equal(slot.heldUntil ?? null, null, 'the hold did not stomp the booking');
  });

  test('a link revoked while Stripe was answering holds nothing', async () => {
    // Checked inside the transaction, not only before it: she can revoke at
    // any moment, and a hold on a revoked link is money with no hour behind it.
    const racer = fakeStripe({
      async createCheckoutSession(params) {
        this.calls.push(params);
        await db.doc('links/tok1').update({ revoked: true });
        return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
      },
    });
    const out = await start(racer);
    assert.equal(out.status, 409);
    assert.equal((await db.collection('bookings').get()).size, 0);
  });

  test('an expired or spent link takes nothing', async () => {
    await db.doc('links/tok1').update({ bookedCount: 1 });
    assert.equal((await start(fakeStripe())).status, 404);
  });

  test('no salon means no key to seal to, so no payment', async () => {
    await db.doc('salon/me').delete();
    assert.equal((await start(fakeStripe())).status, 404);
  });
});

describe('who the deposit is for', () => {
  /**
   * A deposit is only half a transaction if nobody knows whose it is. The
   * envelope has to be captured BEFORE the money moves, because the webhook
   * arrives long after the page holding those details has closed — there is no
   * later moment to collect them in.
   */
  test('will not take money without knowing who is paying', async () => {
    const out = await startDeposit(db, 'tok1', 's0', {
      stripe: fakeStripe(), now: NOW, origin: 'https://book.test',
    });
    assert.equal(out.status, 400);
  });

  test('stores the envelope with the booking, before Stripe is involved', async () => {
    const out = await start(fakeStripe());
    assert.equal((await db.doc(`bookings/${out.body.bookingId}`).get()).data().sealed, ENVELOPE);
  });

  test('refuses an envelope big enough to be someone using the store as disk', async () => {
    const out = await start(fakeStripe(), { sealed: ENVELOPE.repeat(4097) });
    assert.equal(out.status, 413);
  });

  test('will not take money without the policy being agreed', async () => {
    // This path ENDS IN A BOOKING and it is the one that takes money, so the
    // same server-side check book() does applies here too. A boolean from the
    // browser proves nothing, but its absence is still disqualifying.
    await db.doc('links/tok1').update({ policyId: 'pol-1' });
    const out = await start(fakeStripe(), { agreed: false });
    assert.equal(out.status, 422);
  });

  test('records what was agreed, pinned to the policy the link served', async () => {
    await db.doc('links/tok1').update({ policyId: 'pol-1' });
    const out = await start(fakeStripe());
    const b = (await db.doc(`bookings/${out.body.bookingId}`).get()).data();
    assert.equal(b.agreedPolicyId, 'pol-1');
    assert.equal(b.agreedAt, NOW);
  });
});
