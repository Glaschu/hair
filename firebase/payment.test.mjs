import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, advances, reconcileOne, breachingLiveness,
  RANK, ALARMING, LIVENESS_MS,
} from './src/payment.mjs';

/**
 * These are the cases that decide whether a deposit can go missing. Each one is
 * named for the money it protects rather than the branch it covers.
 *
 * The object under test is always a FRESHLY RE-FETCHED payment, not an event
 * payload — that distinction is the whole reason most of these pass.
 */

const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;

const paid = (over = {}) => ({
  bookingId: 'bk_1',
  paymentStatus: 'paid',
  amountMinor: 4500,
  currency: 'gbp',
  amountRefundedMinor: 0,
  disputed: false,
  refundFailed: false,
  ...over,
});

describe('what counts as paid', () => {
  test('a paid session for the expected amount confirms', () => {
    assert.deepEqual(classify(paid(), { expectedAmountMinor: 4500 }),
      { to: 'confirmed', reason: 'paid' });
  });

  test('a completed session that is still unpaid does NOT confirm', () => {
    // Delayed methods complete the session before the money exists. Confirming
    // here puts an unfunded appointment in the diary.
    assert.equal(classify(paid({ paymentStatus: 'unpaid' })).to, 'pending');
    assert.equal(classify(paid({ paymentStatus: 'processing' })).to, 'pending');
  });

  test('money arriving later confirms it, money failing later does not', () => {
    assert.equal(classify(paid({ paymentStatus: 'paid' }), { expectedAmountMinor: 4500 }).to, 'confirmed');
    assert.equal(classify(paid({ paymentStatus: 'failed' })).to, 'pending');
  });

  test('the wrong amount is held for review, never quietly accepted', () => {
    // She edited her price while a checkout was open. The figure frozen at hold
    // time is the only one that counts.
    const out = classify(paid({ amountMinor: 3000 }), { expectedAmountMinor: 4500 });
    assert.equal(out.to, 'held_for_review');
    assert.equal(out.reason, 'amount_mismatch');
  });

  test('the wrong currency is held for review', () => {
    assert.equal(classify(paid({ currency: 'eur' }), { expectedAmountMinor: 4500 }).to, 'held_for_review');
  });

  test('a missing object is held for review rather than assumed good', () => {
    assert.equal(classify(null).to, 'held_for_review');
  });
});

describe('refunds and disputes', () => {
  test('a full refund reads as refunded', () => {
    assert.equal(classify(paid({ amountRefundedMinor: 4500 })).to, 'refunded');
  });

  test('a partial refund is its own classification, not a rounding of the other two', () => {
    // Her policy can refund half a deposit, and half-refunded is neither
    // confirmed nor refunded. Without this it falls through the invariant.
    assert.equal(classify(paid({ amountRefundedMinor: 2250 })).to, 'partially_refunded');
  });

  test('a dispute outranks everything, including a paid status', () => {
    assert.equal(classify(paid({ disputed: true }), { expectedAmountMinor: 4500 }).to, 'reversed');
  });

  test('a refund that did not settle is not a success', () => {
    // She still has the money and the client believes they were refunded. That
    // is the version of this that ends in a chargeback, so it alarms.
    const out = classify(paid({ refundFailed: true }));
    assert.equal(out.to, 'refund_failed');
    assert.ok(ALARMING.has(out.to));
  });

  test('a refund overtaking a confirmation cannot produce a confirmation', () => {
    // The ordering bug that re-fetching exists to kill: the refund event arrives
    // first, so current truth already shows the refund.
    assert.equal(classify(paid({ amountRefundedMinor: 4500 }), { expectedAmountMinor: 4500 }).to, 'refunded');
  });
});

describe('the ladder only goes one way', () => {
  test('a redelivered event changes nothing', () => {
    assert.equal(advances('confirmed', 'confirmed'), false);
    assert.equal(advances('refunded', 'refunded'), false);
  });

  test('a late confirmation cannot undo a refund', () => {
    assert.equal(advances('refunded', 'confirmed'), false);
    assert.equal(advances('reversed', 'confirmed'), false);
  });

  test('but a refund can supersede a confirmation', () => {
    assert.equal(advances('confirmed', 'refunded'), true);
    assert.equal(advances('confirmed', 'reversed'), true);
  });

  test('a partial refund becoming a full one is real news at the same rank', () => {
    assert.equal(RANK.partially_refunded, RANK.refunded);
    assert.equal(advances('partially_refunded', 'refunded'), true);
  });

  test('nothing escapes closed', () => {
    for (const to of Object.keys(RANK)) {
      if (to === 'closed') continue;
      assert.equal(advances('closed', to), false, `closed must not fall back to ${to}`);
    }
  });
});

describe('the reconciler, which does not trust webhook delivery', () => {
  const local = (over = {}) => ({
    bookingId: 'bk_1', classification: 'confirmed',
    expectedAmountMinor: 4500, appointmentId: 'ap_1',
    updatedAt: NOW - h(1), ...over,
  });

  test('a matching pair is left alone', () => {
    assert.equal(reconcileOne({ stripe: paid(), local: local() }).action, 'ok');
  });

  test('a succeeded payment with no booking is repaired', () => {
    // Six hours of webhook outage, three bookings taken. This is what gets them
    // back without anyone noticing they were gone.
    const out = reconcileOne({ stripe: paid(), local: null });
    assert.equal(out.action, 'repair');
    assert.equal(out.reason, 'succeeded_payment_with_no_booking');
  });

  test('a confirmed booking with no appointment is repaired', () => {
    const out = reconcileOne({ stripe: paid(), local: local({ appointmentId: null }) });
    assert.equal(out.action, 'repair');
    assert.equal(out.reason, 'confirmed_without_appointment');
  });

  test('a dispute is FLAGGED, never repaired', () => {
    // Repairing here would re-confirm an appointment whose money has gone —
    // papering over the one case that most needs a human.
    const out = reconcileOne({ stripe: paid({ disputed: true }), local: local() });
    assert.equal(out.action, 'flag');
    assert.equal(out.reason, 'disputed');
  });

  test('drift towards a refund is repaired to match Stripe, not the other way', () => {
    const out = reconcileOne({ stripe: paid({ amountRefundedMinor: 4500 }), local: local() });
    assert.equal(out.action, 'repair');
    assert.equal(out.to, 'refunded');
  });

  test('payments that were never ours are ignored, not reported forever', () => {
    // She has Tap to Pay and dashboard invoices. Counting those as discrepancies
    // makes the report permanently non-zero, and a report that is always red is
    // a report nobody reads.
    const out = reconcileOne({ stripe: paid({ bookingId: null }), local: null });
    assert.equal(out.action, 'ignore');
  });

  test('a repair decision is idempotent — running it again says the same thing', () => {
    const stripe = paid({ amountRefundedMinor: 4500 });
    const first = reconcileOne({ stripe, local: local() });
    const afterRepair = local({ classification: first.to });
    assert.equal(reconcileOne({ stripe, local: afterRepair }).action, 'ok');
  });
});

describe('liveness — nothing sits unresolved in silence', () => {
  test('a payment stuck pending past the window surfaces', () => {
    const rows = [{ bookingId: 'a', classification: 'pending', updatedAt: NOW - LIVENESS_MS - 1 }];
    assert.equal(breachingLiveness(rows, NOW).length, 1);
  });

  test('a payment pending for ten minutes does not', () => {
    const rows = [{ bookingId: 'a', classification: 'pending', updatedAt: NOW - h(0.2) }];
    assert.equal(breachingLiveness(rows, NOW).length, 0);
  });

  test('held for review, refund failures and disputes surface immediately', () => {
    // These do not get 24 hours of grace. Somebody is out of pocket right now.
    const rows = ['held_for_review', 'refund_failed', 'reversed'].map((c, i) =>
      ({ bookingId: `b${i}`, classification: c, updatedAt: NOW }));
    assert.equal(breachingLiveness(rows, NOW).length, 3);
  });

  test('confirmed and closed are never noise', () => {
    const rows = [
      { bookingId: 'a', classification: 'confirmed', updatedAt: NOW - h(1000) },
      { bookingId: 'b', classification: 'closed', updatedAt: NOW - h(1000) },
    ];
    assert.deepEqual(breachingLiveness(rows, NOW), []);
  });
});
