/**
 * Stripe's shapes, turned into the one the classifier reads.
 *
 * This file is the seam the design kept calling "an assumption". The payment
 * logic was proven against stubs I wrote; this maps what Stripe ACTUALLY
 * returns onto those stubs, and the tests beside it use responses captured
 * from a live test-mode account rather than invented ones.
 *
 * Field names verified against the API on 22 September 2026:
 *
 *   checkout.session   payment_status, amount_total, currency,
 *                      client_reference_id, payment_intent, expires_at
 *   payment_intent     status, amount, amount_received, currency,
 *                      latest_charge, metadata
 *   charge             amount_refunded, refunded, disputed, refunds.data[].status
 *
 * Two things confirmed at the same time, both of which the design had only
 * asserted: a Checkout Session's `expires_at` defaults to exactly 24 hours
 * after creation, and Stripe refuses anything under 30 minutes.
 */

export const EXPIRES_FLOOR_SECONDS = 30 * 60;
export const EXPIRES_DEFAULT_SECONDS = 24 * 60 * 60;

/** The soonest a session may be set to expire. Anything less is rejected by Stripe. */
export function earliestExpiry(createdSeconds) {
  return createdSeconds + EXPIRES_FLOOR_SECONDS;
}

function refundState(charge) {
  const refunds = charge?.refunds?.data ?? [];
  // A refund that was created and then failed is not a refund. She still has
  // the money and the client believes they were refunded, which is the version
  // of this that ends in a chargeback.
  const failed = refunds.some((r) => r.status === 'failed');
  return {
    amountRefundedMinor: charge?.amount_refunded ?? 0,
    refundFailed: failed,
  };
}

/**
 * From a Checkout Session, ideally expanded with its PaymentIntent and charge.
 *
 * `payment_status` is the field that decides whether money exists — a session
 * can be `complete` with `payment_status: 'unpaid'` for delayed methods, which
 * is exactly how an unfunded appointment gets into the diary.
 */
export function fromCheckoutSession(session, charge = null) {
  const pi = typeof session?.payment_intent === 'object' ? session.payment_intent : null;
  const resolvedCharge = charge
    ?? (typeof pi?.latest_charge === 'object' ? pi.latest_charge : null);

  return {
    bookingId: session?.client_reference_id
      ?? pi?.metadata?.iris_booking_id
      ?? null,
    // What a refund is issued against. Unexpanded it is a bare id string.
    paymentIntentId: pi?.id
      ?? (typeof session?.payment_intent === 'string' ? session.payment_intent : null),
    sessionId: session?.id ?? null,
    paymentStatus: session?.payment_status ?? 'unpaid',
    amountMinor: session?.amount_total ?? 0,
    currency: session?.currency ?? null,
    disputed: resolvedCharge?.disputed === true,
    ...refundState(resolvedCharge),
  };
}

/**
 * From a PaymentIntent, which is what the reconciler walks.
 *
 * A session carries `client_reference_id`; a PaymentIntent does not — which is
 * why the booking id is also written into `payment_intent_data.metadata` at
 * session creation. Without that, half the reconciler's sweep cannot be mapped
 * back to a booking.
 */
export function fromPaymentIntent(pi, charge = null) {
  const resolvedCharge = charge
    ?? (typeof pi?.latest_charge === 'object' ? pi.latest_charge : null);

  return {
    bookingId: pi?.metadata?.iris_booking_id ?? null,
    paymentIntentId: pi?.id ?? null,
    sessionId: null,
    // `succeeded` is the only status that means the money is there.
    // `requires_source`, `requires_payment_method`, `processing` and the rest
    // all mean it is not, and must not confirm an appointment.
    paymentStatus: pi?.status === 'succeeded' ? 'paid'
      : pi?.status === 'processing' ? 'processing'
      : 'unpaid',
    amountMinor: pi?.amount_received > 0 ? pi.amount_received : (pi?.amount ?? 0),
    currency: pi?.currency ?? null,
    disputed: resolvedCharge?.disputed === true,
    ...refundState(resolvedCharge),
  };
}
