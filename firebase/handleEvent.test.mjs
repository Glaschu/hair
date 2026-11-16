import { testDb, wipe, closeDb } from './src/testDb.mjs';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleEvent } from './src/handleEvent.mjs';

// Thin shims so the test bodies read the same as before. The Admin SDK is
// method-on-reference where the client SDK is free functions; nothing else
// about these tests changes.
const doc = (d, path) => d.doc(path);
const collection = (d, path) => d.collection(path);
const setDoc = (ref, data) => ref.set(data);
const getDoc = (ref) => ref.get();
const getDocs = (q) => q.get();

/**
 * The webhook handler, against a real database.
 *
 * Stripe's own shapes are stubbed — `fetchObject` stands in for the re-fetch —
 * so these prove the LOGIC is right. Proving the shapes are right needs a
 * sandbox and `stripe trigger`, and that is called out in the design as the one
 * thing still waiting on an account.
 */

let db, FieldValue, app;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);

before(() => { ({ db, FieldValue, app } = testDb('iris-webhook-test')); });
after(async () => { await closeDb(app); });
beforeEach(async () => { await wipe(db); });

/**
 * A deposit mid-checkout, as startDeposit leaves it: the booking waiting for
 * payment, and its own hold on the slot. Anything less is not a booking the
 * webhook can ever actually meet.
 */
const booking = async (over = {}) => {
  await setDoc(doc(db, 'links/tok1'), {
    revoked: false, maxBookings: 1, bookedCount: 0, expiresAt: NOW + 86_400_000,
    slots: [{ id: 's0', s: NOW + 50 * 3_600_000, e: NOW + 53 * 3_600_000,
              taken: false, heldBy: 'bk_1', heldUntil: NOW + 600_000 }],
  });
  return setDoc(doc(db, 'bookings/bk_1'), {
    classification: 'pending', status: 'pending_payment', token: 'tok1', slotId: 's0',
    expectedAmountMinor: 4500, currency: 'gbp', ...over,
  });
};

const object = (over = {}) => ({
  bookingId: 'bk_1', paymentStatus: 'paid', amountMinor: 4500, currency: 'gbp',
  amountRefundedMinor: 0, disputed: false, refundFailed: false, ...over,
});

const fire = (id, obj, type = 'checkout.session.completed') =>
  handleEvent(db, { event: { id, type }, fetchObject: async () => obj, now: NOW });

const read = async (path) => (await getDoc(doc(db, path))).data();
const outboxKinds = async () =>
  (await getDocs(collection(db, 'outbox'))).docs.map((d) => d.data().kind).sort();

describe('a paid deposit', () => {
  test('confirms the booking and queues the messages', async () => {
    await booking();
    const out = await fire('evt_1', object());

    assert.equal(out.action, 'applied');
    assert.equal((await read('bookings/bk_1')).classification, 'confirmed');
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist']);
  });

  test('the messages are queued, never sent, inside the handler', async () => {
    // Function instances are frozen the instant they respond, so anything after
    // the 200 may simply never happen.
    await booking();
    await fire('evt_1', object());
    const rows = await getDocs(collection(db, 'outbox'));
    assert.ok(rows.docs.every((d) => d.data().state === 'pending'));
  });
});

describe('the same event arriving more than once', () => {
  test('is applied once, however many times it lands', async () => {
    await booking();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await fire('evt_1', object()));

    assert.equal(results[0].action, 'applied');
    assert.ok(results.slice(1).every((r) => r.action === 'duplicate'));
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist'],
      'and the client is not told twice');
  });

  test('five concurrent deliveries produce one confirmation', async () => {
    await booking();
    const all = await Promise.all(Array.from({ length: 5 }, () => fire('evt_1', object())));
    assert.equal(all.filter((r) => r.action === 'applied').length, 1);
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist']);
  });

  test('losing the race is not an error — the caller must still answer 200', async () => {
    // Returning 500 makes Stripe retry into the same race, which amplifies into
    // something that looks like an outage.
    await booking();
    await fire('evt_1', object());
    const again = await fire('evt_1', object());
    assert.equal(again.action, 'duplicate');
  });
});

describe('events out of order', () => {
  test('a refund arriving before the confirmation never produces a confirmation', async () => {
    await booking();
    // The refund lands first, so the re-fetch already shows current truth.
    await fire('evt_refund', object({ amountRefundedMinor: 4500 }), 'charge.refunded');
    assert.equal((await read('bookings/bk_1')).classification, 'refunded');

    // Now the older completion event turns up.
    const late = await fire('evt_paid', object({ amountRefundedMinor: 4500 }));
    assert.equal(late.action, 'dropped');
    assert.equal((await read('bookings/bk_1')).classification, 'refunded');
    assert.deepEqual(await outboxKinds(), [], 'nobody is told they are booked');
  });

  test('a backwards transition is recorded, not silently swallowed', async () => {
    await booking({ classification: 'refunded' });
    await fire('evt_1', object());
    const marker = await read('processedEvents/evt_1');
    assert.equal(marker.outcome, 'superseded');
    assert.equal(marker.wouldHaveBeen, 'confirmed');
    assert.equal(marker.kept, 'refunded');
  });
});

describe('the ways a payment is not really paid', () => {
  test('a completed session that is still unpaid does not confirm', async () => {
    await booking();
    await fire('evt_1', object({ paymentStatus: 'unpaid' }));
    assert.equal((await read('bookings/bk_1')).classification, 'pending');
    assert.deepEqual(await outboxKinds(), []);
  });

  test('the money arriving later does confirm it', async () => {
    await booking();
    await fire('evt_1', object({ paymentStatus: 'unpaid' }));
    await fire('evt_2', object({ paymentStatus: 'paid' }), 'checkout.session.async_payment_succeeded');
    assert.equal((await read('bookings/bk_1')).classification, 'confirmed');
  });

  test('the money failing later never does', async () => {
    await booking();
    await fire('evt_1', object({ paymentStatus: 'unpaid' }));
    await fire('evt_2', object({ paymentStatus: 'failed' }), 'checkout.session.async_payment_failed');
    assert.equal((await read('bookings/bk_1')).classification, 'pending');
    assert.deepEqual(await outboxKinds(), [], 'no appointment was ever promised');
  });

  test('the wrong amount is held for review rather than accepted', async () => {
    await booking();
    const out = await fire('evt_1', object({ amountMinor: 3000 }));
    assert.equal(out.to, 'held_for_review');
    assert.deepEqual(await outboxKinds(), []);
  });
});

describe('a dispute', () => {
  test('reverses the payment and does not re-confirm afterwards', async () => {
    await booking();
    await fire('evt_paid', object());
    await fire('evt_dispute', object({ disputed: true }), 'charge.dispute.created');
    assert.equal((await read('bookings/bk_1')).classification, 'reversed');

    // A redelivered completion must not undo it.
    const replay = await fire('evt_paid_again', object({ disputed: true }));
    assert.equal(replay.action, 'dropped');
    assert.equal((await read('bookings/bk_1')).classification, 'reversed');
  });
});

describe('a payment with no booking behind it', () => {
  test('is recorded as an orphan rather than dropped on the floor', async () => {
    // Silence here is the failure: the money exists, so somebody has to know.
    const out = await fire('evt_1', object());
    assert.equal(out.action, 'orphan');
    assert.ok(await read('orphanPayments/bk_1'));
    assert.equal((await read('processedEvents/evt_1')).outcome, 'orphan');
  });

  test('a payment that was never ours is ignored, and said so', async () => {
    const out = await fire('evt_1', object({ bookingId: null }));
    assert.equal(out.action, 'ignored');
    assert.equal((await read('processedEvents/evt_1')).outcome, 'ignored');
  });
});

describe('the booking status, not just the money', () => {
  /**
   * The classification says what the MONEY did. `status` says what the BOOKING
   * is, and her device reads that one — the inbox asks for
   * `status == 'confirmed'`.
   *
   * Moving one without the other was a real defect: a paid deposit advanced to
   * classification `confirmed` while status stayed `pending_payment`, where
   * nothing would ever look at it again. Money taken, appointment never
   * delivered — the exact outcome this whole design exists to prevent.
   */
  test('a paid deposit becomes visible to her device', async () => {
    await booking({ status: 'pending_payment' });
    await fire('evt_1', object());

    const b = await read('bookings/bk_1');
    assert.equal(b.classification, 'confirmed');
    assert.equal(b.status, 'confirmed', 'the inbox queries status, so this is the field that matters');
    assert.equal(typeof b.confirmedAt, 'number');
  });

  test('a booking she already cancelled is not resurrected by a late webhook', async () => {
    // The payment may well confirm after she cancelled. The money story moves
    // on; the appointment does not come back — and the money goes back.
    await booking({ status: 'cancelled' });
    await fire('evt_1', object());

    const b = await read('bookings/bk_1');
    assert.equal(b.classification, 'confirmed', 'the money is still tracked');
    assert.equal(b.status, 'cancelled', 'but the appointment stays cancelled');
    assert.deepEqual(await outboxKinds(), ['notify_stylist', 'refund_deposit'],
      'no "you are booked" message for an appointment that does not exist');
    assert.equal((await read('links/tok1')).slots[0].taken, false, 'and the hour is not taken');
  });

  test('a refund does not quietly change what the booking is', async () => {
    // Cancelling is its own flow, with its own notice and refund tiers. A
    // refund event must not shortcut it.
    await booking({ status: 'confirmed', classification: 'confirmed' });
    await fire('evt_2', object({ amountRefundedMinor: 4500 }));

    const b = await read('bookings/bk_1');
    assert.equal(b.classification, 'refunded');
    assert.equal(b.status, 'confirmed');
  });

  test('an unpaid session confirms nothing, in either field', async () => {
    await booking({ status: 'pending_payment' });
    await fire('evt_1', object({ paymentStatus: 'unpaid' }));

    const b = await read('bookings/bk_1');
    assert.notEqual(b.classification, 'confirmed');
    assert.equal(b.status, 'pending_payment');
  });
});
