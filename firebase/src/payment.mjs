/**
 * What a payment is, and what may happen to it next.
 *
 * Revision 3 of the design claimed every succeeded payment "reaches exactly one
 * terminal state". That is false, and the design's own dispute drill refutes
 * it: a payment that is confirmed and then disputed has occupied two. Money can
 * move for months after a booking, so `confirmed` is not terminal.
 *
 * What replaces it is two separable properties, both checkable:
 *
 *   CLASSIFICATION — a payment carries exactly one CURRENT classification on a
 *   monotonic ladder, and every transition is recorded with its cause. A
 *   reversal supersedes a confirmation rather than contradicting it.
 *
 *   LIVENESS — nothing sits in a classification that is neither `confirmed` nor
 *   `closed` for more than 24 hours without a human being told.
 */

/**
 * The ladder. A transition that would move *down* it is dropped and recorded,
 * never applied — which is what makes out-of-order webhook delivery harmless
 * instead of catastrophic.
 */
export const RANK = {
  unknown: 0,
  pending: 1,
  confirmed: 2,
  partially_refunded: 3,
  refunded: 3,
  reversed: 3,
  refund_failed: 3,
  held_for_review: 3,
  closed: 4,
};

/** Classifications that need somebody to look, and how urgently. */
export const ALARMING = new Set(['held_for_review', 'refund_failed', 'reversed']);

/** Beyond this, an unresolved payment stops being pending and starts being a problem. */
export const LIVENESS_MS = 24 * 60 * 60 * 1000;

/**
 * What an event means, computed from a FRESHLY RE-FETCHED object rather than
 * the event payload.
 *
 * The payload is a snapshot from when the event was created, and events arrive
 * out of order — a refund can overtake a confirmation. Re-reading current truth
 * on every event is one extra API call at her volume and makes most ordering
 * bugs disappear.
 */
export function classify(object, { expectedAmountMinor, expectedCurrency = 'gbp' } = {}) {
  if (!object) return { to: 'held_for_review', reason: 'object_missing' };

  if (object.disputed) return { to: 'reversed', reason: 'dispute' };

  if (object.refundFailed) {
    // Not a success dressed up as one. She still has the money and the client
    // believes they were refunded, which is the version of this that ends in a
    // chargeback.
    return { to: 'refund_failed', reason: 'refund_did_not_settle' };
  }

  if (object.amountRefundedMinor > 0) {
    const whole = object.amountRefundedMinor >= object.amountMinor;
    return { to: whole ? 'refunded' : 'partially_refunded', reason: 'refund' };
  }

  if (object.paymentStatus === 'unpaid' || object.paymentStatus === 'processing') {
    // Delayed methods complete the session before the money exists. Confirming
    // here is how an unfunded appointment gets into the diary.
    return { to: 'pending', reason: 'awaiting_funds' };
  }

  if (object.paymentStatus !== 'paid') return { to: 'pending', reason: 'not_paid' };

  // Paid — but for the right amount? Never trust a figure the browser could
  // have influenced, and never compare against the live service price, which
  // she may have edited mid-checkout.
  if (typeof expectedAmountMinor === 'number' && object.amountMinor !== expectedAmountMinor) {
    return { to: 'held_for_review', reason: 'amount_mismatch' };
  }
  if (object.currency && object.currency !== expectedCurrency) {
    return { to: 'held_for_review', reason: 'currency_mismatch' };
  }

  return { to: 'confirmed', reason: 'paid' };
}

/**
 * Whether a classification may replace the one already recorded.
 *
 * Equal rank is allowed through only when the classification actually differs —
 * a partial refund becoming a full one is real news; the same event redelivered
 * is not.
 */
export function advances(from, to) {
  const a = RANK[from] ?? 0;
  const b = RANK[to] ?? 0;
  if (b > a) return true;
  return b === a && from !== to;
}

/**
 * The reconciler's verdict for one payment, given what Stripe says and what we
 * recorded.
 *
 * This is the backstop that does not depend on webhook delivery, and it is what
 * turns the invariant from a hope into something checked on a schedule.
 */
export function reconcileOne({ stripe, local, now = Date.now() }) {
  // Payments that were never ours — she has Tap to Pay and dashboard invoices
  // too. Without this the reconciler reports a permanent discrepancy and becomes
  // noise she stops reading.
  if (!stripe.bookingId) return { action: 'ignore', reason: 'not_an_iris_payment' };

  if (!local) {
    return { action: 'repair', reason: 'succeeded_payment_with_no_booking', bookingId: stripe.bookingId };
  }

  const should = classify(stripe, { expectedAmountMinor: local.expectedAmountMinor });

  if (local.classification !== should.to) {
    // A dispute is the one case where "repair" would be exactly wrong: the
    // money is gone and re-confirming would paper over it.
    if (should.to === 'reversed') {
      return { action: 'flag', reason: 'disputed', bookingId: stripe.bookingId };
    }
    return { action: 'repair', reason: `drifted_to_${should.to}`, bookingId: stripe.bookingId, to: should.to };
  }

  if (local.classification === 'confirmed' && !local.appointmentId) {
    return { action: 'repair', reason: 'confirmed_without_appointment', bookingId: stripe.bookingId };
  }

  return { action: 'ok', reason: 'matches' };
}

/** Payments that have sat too long without resolving. */
export function breachingLiveness(rows, now, window = LIVENESS_MS) {
  return rows.filter((r) => {
    if (r.classification === 'confirmed' || r.classification === 'closed') return false;
    if (ALARMING.has(r.classification)) return true;
    return now - (r.updatedAt ?? r.createdAt ?? 0) > window;
  });
}
