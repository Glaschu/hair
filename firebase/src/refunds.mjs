/**
 * Turning a queued refund into money back on a card.
 *
 * Called by the outbox drain, which owns the hard parts: the lease that stops
 * two runs refunding at once, the deterministic idempotency key, and the rule
 * that a refund older than Stripe's idempotency window is never blind-retried.
 * This only has to find what to refund and ask.
 */

/**
 * @param stripe  { createRefund, retrieveCheckoutSession }
 * @returns a `send` for drainOutbox
 */
export function refundSender(db, stripe, { salonPath = '' } = {}) {
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);

  return async (row) => {
    if (row.kind !== 'refund_deposit') {
      return { ok: false, error: `not a refund: ${row.kind}`, permanent: true };
    }
    if (!(row.amountMinor > 0)) {
      return { ok: false, error: 'nothing to refund', permanent: true };
    }

    // The payment a refund is issued against. Usually recorded at
    // confirmation; if the confirmation came from an event that did not carry
    // it, the session still knows.
    let paymentIntent = row.paymentIntentId;
    if (!paymentIntent) {
      const booking = (await db.doc(p(`bookings/${row.subjectId}`)).get()).data();
      paymentIntent = booking?.stripe?.paymentIntentId ?? null;
      if (!paymentIntent && booking?.stripe?.sessionId) {
        const session = await stripe.retrieveCheckoutSession(booking.stripe.sessionId);
        paymentIntent = typeof session?.payment_intent === 'string'
          ? session.payment_intent
          : session?.payment_intent?.id ?? null;
      }
    }
    if (!paymentIntent) {
      // Permanent: retrying will not conjure a payment. It goes to the list
      // she is shown, rather than being retried quietly into the ground.
      return { ok: false, error: 'no payment found to refund', permanent: true };
    }

    await stripe.createRefund({
      payment_intent: paymentIntent,
      amount: row.amountMinor,
      metadata: { iris_booking_id: row.subjectId, reason: row.reason ?? 'refund' },
      idempotency_key: row.idempotencyKey,
    });
    return { ok: true };
  };
}
