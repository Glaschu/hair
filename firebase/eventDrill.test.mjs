import { testDb, wipe, closeDb } from './src/testDb.mjs';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readEvent, sign } from './src/stripeWebhook.mjs';
import { handleEvent } from './src/handleEvent.mjs';
import { fromCheckoutSession } from './src/stripeShape.mjs';

/**
 * The failure drill, run end to end: signed payload → door → handler → database.
 *
 * The pieces each have their own tests. This is about the seams between them,
 * which is where the drill table in the design says the real risk is. Every
 * scenario here is one row of that table.
 *
 * No Stripe CLI — payloads are signed with Stripe's own scheme, which is what
 * lets a refund be delivered before its confirmation and a secret be rotated
 * mid-flight, exactly, rather than approximately.
 */

let db, app;
const SECRET = 'whsec_drill';
const ROTATED = 'whsec_drill_new';
const NOW_MS = Date.UTC(2026, 9, 3, 9, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

before(() => { ({ db, app } = testDb('iris-drill-test')); });
after(async () => { await closeDb(app); });
beforeEach(async () => {
  await wipe(db);
  // A deposit mid-checkout, exactly as startDeposit leaves one: waiting for
  // payment, holding its slot. An earlier version of this fixture had no status
  // and no link, and the drill passed for the wrong reason — a refund and a
  // notice are also two outbox rows.
  await db.doc('links/tok1').set({
    revoked: false, maxBookings: 1, bookedCount: 0, expiresAt: NOW_MS + 86_400_000,
    slots: [{ id: 's0', s: NOW_MS + 50 * 3_600_000, e: NOW_MS + 53 * 3_600_000,
              taken: false, heldBy: 'bk_1', heldUntil: NOW_MS + 600_000 }],
  });
  await db.doc('bookings/bk_1').set({
    classification: 'pending', status: 'pending_payment', token: 'tok1', slotId: 's0',
    expectedAmountMinor: 4500, currency: 'gbp',
  });
});

/** A real-shaped session payload, signed the way Stripe signs. */
function delivery(id, over = {}, { secret = SECRET, t = NOW_S } = {}) {
  const raw = JSON.stringify({
    id, type: 'checkout.session.completed',
    data: {
      object: {
        object: 'checkout.session', payment_status: 'paid',
        amount_total: 4500, currency: 'gbp', client_reference_id: 'bk_1',
        ...over,
      },
    },
  });
  return { raw, header: `t=${t},v1=${sign(raw, secret, t)}` };
}

/** The whole path a real request takes. */
async function deliver({ raw, header }, secrets = [SECRET]) {
  const door = readEvent(raw, header, secrets, { now: NOW_S });
  if (!door.ok) return { rejected: door.reason };

  const object = fromCheckoutSession(door.event.data.object);
  return handleEvent(db, {
    event: { id: door.event.id, type: door.event.type },
    fetchObject: async () => object,
    now: NOW_MS,
  });
}

const classificationOf = async () =>
  (await db.doc('bookings/bk_1').get()).data().classification;
const outboxSize = async () => (await db.collection('outbox').get()).size;
const outboxKinds = async () =>
  (await db.collection('outbox').get()).docs.map((d) => d.data().kind).sort();

describe('drill · a genuine deposit', () => {
  test('confirms once and queues the messages', async () => {
    const out = await deliver(delivery('evt_1'));
    assert.equal(out.action, 'applied');
    assert.equal(await classificationOf(), 'confirmed');
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist']);
    const b = (await db.doc('bookings/bk_1').get()).data();
    assert.equal(b.status, 'confirmed', 'visible to her inbox');
    const slot = (await db.doc('links/tok1').get()).data().slots[0];
    assert.equal(slot.taken, true, 'and the hour is taken, so it cannot be sold twice');
  });
});

describe('drill · replay', () => {
  test('the same delivery five times confirms once', async () => {
    const d = delivery('evt_1');
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await deliver(d));

    assert.equal(results[0].action, 'applied');
    assert.ok(results.slice(1).every((r) => r.action === 'duplicate'));
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist'], 'the client is not told five times');
  });

  test('five concurrent deliveries confirm once', async () => {
    const d = delivery('evt_1');
    const all = await Promise.all(Array.from({ length: 5 }, () => deliver(d)));
    assert.equal(all.filter((r) => r.action === 'applied').length, 1);
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist']);
  });

  test('a captured delivery replayed days later never reaches the handler', async () => {
    const stale = delivery('evt_1', {}, { t: NOW_S - 4 * 86_400 });
    assert.equal((await deliver(stale)).rejected, 'timestamp_outside_tolerance');
    assert.equal(await classificationOf(), 'pending', 'the door held');
  });
});

describe('drill · out of order', () => {
  /** A session whose charge already shows the refund — which is what a re-fetch returns. */
  const refunded = (id) => delivery(id, {
    payment_intent: {
      latest_charge: { amount_refunded: 4500, disputed: false, refunds: { data: [] } },
    },
  });

  test('a refund delivered before its confirmation never produces a confirmation', async () => {
    // The ordering hazard, end to end. The refund lands first, so when the
    // older completion event turns up, current truth already shows the refund —
    // because the handler re-fetches rather than trusting the payload it was
    // handed.
    const first = await deliver(refunded('evt_refund'));
    assert.equal(first.to, 'refunded');
    assert.equal(await classificationOf(), 'refunded');

    const late = await deliver(refunded('evt_paid'));
    assert.equal(late.action, 'dropped', 'a later event cannot walk back down the ladder');
    assert.equal(await classificationOf(), 'refunded');
    assert.equal(await outboxSize(), 0, 'nobody is ever told they are booked');
  });

  test('a confirmation followed by a refund ends refunded, and is not re-confirmed', async () => {
    await deliver(delivery('evt_paid'));
    assert.equal(await classificationOf(), 'confirmed');

    await deliver(refunded('evt_refund'));
    assert.equal(await classificationOf(), 'refunded');

    const replay = await deliver(delivery('evt_paid_again'));
    assert.equal(replay.action, 'dropped');
    assert.equal(await classificationOf(), 'refunded');
  });
});

describe('drill · rotating the signing secret mid-flight', () => {
  test('deliveries signed with either secret are handled during the overlap', async () => {
    const old = await deliver(delivery('evt_old', {}, { secret: SECRET }), [SECRET, ROTATED]);
    assert.equal(old.action, 'applied');

    await db.doc('bookings/bk_2').set({
      classification: 'pending', expectedAmountMinor: 4500, currency: 'gbp',
    });
    const fresh = await deliver(
      delivery('evt_new', { client_reference_id: 'bk_2' }, { secret: ROTATED }),
      [SECRET, ROTATED],
    );
    assert.equal(fresh.action, 'applied', 'nothing is dropped while the swap happens');
  });

  test('once the old secret is retired its deliveries stop at the door', async () => {
    const out = await deliver(delivery('evt_1', {}, { secret: SECRET }), [ROTATED]);
    assert.equal(out.rejected, 'signature_mismatch');
    assert.equal(await classificationOf(), 'pending');
  });

  test('a rotation done wrong is visible as refusals, not silence', async () => {
    // The outage that looks like "nobody is booking": every delivery refused
    // because the endpoint secret was rotated and the function never updated.
    const refusals = [];
    for (const id of ['evt_1', 'evt_2', 'evt_3']) {
      refusals.push((await deliver(delivery(id), [ROTATED])).rejected);
    }
    assert.deepEqual(refusals, Array(3).fill('signature_mismatch'));
    // Which is exactly why the design alarms on signatureFailures > 0 rather
    // than waiting for someone to notice an empty diary.
  });
});

describe('drill · the ways money is not really there', () => {
  test('an unpaid session confirms nothing, however well signed', async () => {
    const out = await deliver(delivery('evt_1', { payment_status: 'unpaid' }));
    assert.equal(out.to, 'pending');
    assert.equal(await outboxSize(), 0);
  });

  test('the wrong amount is held for review, not accepted', async () => {
    const out = await deliver(delivery('evt_1', { amount_total: 3000 }));
    assert.equal(out.to, 'held_for_review');
    assert.equal(await outboxSize(), 0);
  });

  test('a forged deposit never reaches the database at all', async () => {
    const out = await deliver(delivery('evt_1', {}, { secret: 'whsec_attacker' }));
    assert.equal(out.rejected, 'signature_mismatch');
    assert.equal(await classificationOf(), 'pending');
  });
});
