import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { handleEvent } from './src/handleEvent.mjs';

/**
 * The webhook handler, against a real database.
 *
 * Stripe's own shapes are stubbed — `fetchObject` stands in for the re-fetch —
 * so these prove the LOGIC is right. Proving the shapes are right needs a
 * sandbox and `stripe trigger`, and that is called out in the design as the one
 * thing still waiting on an account.
 */

let env, db;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'iris-webhook-test',
    firestore: {
      rules: 'rules_version = "2"; service cloud.firestore { match /{d=**} { allow read, write: if true; } }',
      host: '127.0.0.1', port: 8080,
    },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  db = env.unauthenticatedContext().firestore();
});

const booking = (over = {}) => setDoc(doc(db, 'bookings/bk_1'), {
  classification: 'pending', expectedAmountMinor: 4500, currency: 'gbp', ...over,
});

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
