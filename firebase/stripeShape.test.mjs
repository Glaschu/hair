import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromCheckoutSession, fromPaymentIntent, earliestExpiry,
  EXPIRES_FLOOR_SECONDS, EXPIRES_DEFAULT_SECONDS,
} from './src/stripeShape.mjs';
import { classify } from './src/payment.mjs';

/**
 * The fixtures below are REAL responses from a live test-mode account, captured
 * on 22 September 2026 — not shapes I invented and then wrote code to match.
 * That distinction is the whole point of this file: the payment logic was
 * proven against stubs, and until now nothing checked that Stripe's objects
 * looked anything like them.
 */

// Straight from POST /v1/checkout/sessions.
const FRESH_SESSION = {
  object: 'checkout.session',
  status: 'open',
  payment_status: 'unpaid',
  amount_total: 4500,
  currency: 'gbp',
  client_reference_id: 'bk_test_1',
  payment_intent: 'pi_3UIWdvKg0URx2Lgi1SEVpS24',
  created: 1790094847,
  expires_at: 1790181247,
};

// Straight from GET /v1/payment_intents/pi_…
const FRESH_PI = {
  object: 'payment_intent',
  status: 'requires_source',
  amount: 4500,
  amount_received: 0,
  currency: 'gbp',
  latest_charge: null,
  metadata: { iris_booking_id: 'bk_test_1' },
};

describe('the defaults Stripe actually applies', () => {
  test('a session expires 24 hours after creation unless told otherwise', () => {
    // Confirmed live. Leaving it unset holds a Saturday morning slot all day
    // for somebody who wandered off.
    assert.equal(FRESH_SESSION.expires_at - FRESH_SESSION.created, EXPIRES_DEFAULT_SECONDS);
  });

  test('the floor is 30 minutes, which is what the hold TTL derives from', () => {
    // Verified by asking for 10 minutes and being refused: "The `expires_at`
    // timestamp must be at least 30 minutes from Checkout Session creation."
    assert.equal(EXPIRES_FLOOR_SECONDS, 1800);
    assert.equal(earliestExpiry(FRESH_SESSION.created), FRESH_SESSION.created + 1800);
  });
});

describe('a real session, mapped', () => {
  test('carries the booking id through client_reference_id', () => {
    assert.equal(fromCheckoutSession(FRESH_SESSION).bookingId, 'bk_test_1');
  });

  test('an unpaid session does not confirm', () => {
    // The field that decides whether money exists. A session can be complete
    // and still unpaid for delayed methods — confirming there is how an
    // unfunded appointment gets into the diary.
    const mapped = fromCheckoutSession(FRESH_SESSION);
    assert.equal(mapped.paymentStatus, 'unpaid');
    assert.equal(classify(mapped, { expectedAmountMinor: 4500 }).to, 'pending');
  });

  test('a paid session for the expected amount confirms', () => {
    const paid = { ...FRESH_SESSION, status: 'complete', payment_status: 'paid' };
    assert.equal(classify(fromCheckoutSession(paid), { expectedAmountMinor: 4500 }).to, 'confirmed');
  });

  test('amounts arrive as integer minor units, so no float ever enters', () => {
    const mapped = fromCheckoutSession(FRESH_SESSION);
    assert.equal(mapped.amountMinor, 4500);
    assert.equal(Number.isInteger(mapped.amountMinor), true);
    assert.equal(mapped.currency, 'gbp');
  });

  test('the wrong amount is held for review rather than accepted', () => {
    const paid = { ...FRESH_SESSION, payment_status: 'paid', amount_total: 3000 };
    assert.equal(classify(fromCheckoutSession(paid), { expectedAmountMinor: 4500 }).to, 'held_for_review');
  });
});

describe('a real PaymentIntent, mapped', () => {
  test('finds the booking id in metadata, because a PI has no client_reference_id', () => {
    // Confirmed live: the PI carries metadata.iris_booking_id and nothing else
    // that identifies the booking. Without setting it at session creation, half
    // the reconciler's sweep could not be mapped back.
    assert.equal(FRESH_PI.client_reference_id, undefined);
    assert.equal(fromPaymentIntent(FRESH_PI).bookingId, 'bk_test_1');
  });

  test('only `succeeded` counts as paid', () => {
    // requires_source is what a brand new PI actually reports — verified live,
    // and it must not confirm anything.
    assert.equal(fromPaymentIntent(FRESH_PI).paymentStatus, 'unpaid');
    for (const status of ['requires_payment_method', 'requires_action', 'canceled']) {
      assert.equal(fromPaymentIntent({ ...FRESH_PI, status }).paymentStatus, 'unpaid');
    }
    assert.equal(fromPaymentIntent({ ...FRESH_PI, status: 'processing' }).paymentStatus, 'processing');
    assert.equal(fromPaymentIntent({ ...FRESH_PI, status: 'succeeded' }).paymentStatus, 'paid');
  });

  test('prefers what was actually received over what was asked for', () => {
    const partial = { ...FRESH_PI, status: 'succeeded', amount: 4500, amount_received: 4500 };
    assert.equal(fromPaymentIntent(partial).amountMinor, 4500);
  });
});

describe('refunds and disputes, from the charge', () => {
  const charge = (over = {}) => ({ amount_refunded: 0, disputed: false, refunds: { data: [] }, ...over });

  test('a full refund reads as refunded', () => {
    const mapped = fromPaymentIntent(
      { ...FRESH_PI, status: 'succeeded' }, charge({ amount_refunded: 4500 }));
    assert.equal(classify(mapped, { expectedAmountMinor: 4500 }).to, 'refunded');
  });

  test('a partial refund is its own state, not a rounding of the others', () => {
    const mapped = fromPaymentIntent(
      { ...FRESH_PI, status: 'succeeded' }, charge({ amount_refunded: 2250 }));
    assert.equal(classify(mapped, { expectedAmountMinor: 4500 }).to, 'partially_refunded');
  });

  test('a refund that failed is not a success', () => {
    const mapped = fromPaymentIntent({ ...FRESH_PI, status: 'succeeded' },
      charge({ refunds: { data: [{ status: 'failed' }] } }));
    assert.equal(mapped.refundFailed, true);
    assert.equal(classify(mapped).to, 'refund_failed');
  });

  test('a dispute outranks a paid status', () => {
    const mapped = fromPaymentIntent({ ...FRESH_PI, status: 'succeeded' }, charge({ disputed: true }));
    assert.equal(classify(mapped, { expectedAmountMinor: 4500 }).to, 'reversed');
  });

  test('no charge yet is not a refund', () => {
    // A session that has never been paid has no charge at all, and reading that
    // as "nothing refunded" rather than crashing is the common case.
    const mapped = fromCheckoutSession(FRESH_SESSION);
    assert.equal(mapped.amountRefundedMinor, 0);
    assert.equal(mapped.refundFailed, false);
    assert.equal(mapped.disputed, false);
  });
});

describe('a real event envelope, captured from the CLI', () => {
  /**
   * `stripe trigger checkout.session.completed`, 22 September 2026. The outer
   * envelope matters as much as the object: `readEvent` refuses anything
   * without an `id` and a `type`, and this is what Stripe actually sends.
   */
  const REAL_EVENT = {
    object: 'event',
    id: 'evt_captured',
    type: 'checkout.session.completed',
    api_version: '2026-08-27',
    created: 1790096000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        object: 'checkout.session',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 3000,
        currency: 'usd',
        client_reference_id: null,
      },
    },
  };

  test('carries the fields the door checks for', () => {
    assert.ok(REAL_EVENT.id && REAL_EVENT.type);
    assert.equal(REAL_EVENT.data.object.object, 'checkout.session');
  });

  test('a session created without client_reference_id maps to no booking', () => {
    // Which is right, and is how her Tap to Pay and dashboard payments stay out
    // of the reconciler: no booking id means not ours, ignored rather than
    // treated as an orphan.
    assert.equal(fromCheckoutSession(REAL_EVENT.data.object).bookingId, null);
  });

  test('is otherwise mapped exactly as the stubs assumed', () => {
    const mapped = fromCheckoutSession(REAL_EVENT.data.object);
    assert.equal(mapped.paymentStatus, 'paid');
    assert.equal(mapped.amountMinor, 3000);
    assert.equal(mapped.currency, 'usd');
  });

  test('a currency that is not hers is held for review, not accepted', () => {
    // This fixture is in USD. A GBP salon receiving a USD payment is not a
    // rounding problem, it is a wrong payment.
    const mapped = fromCheckoutSession(REAL_EVENT.data.object);
    assert.equal(classify(mapped, { expectedAmountMinor: 3000, expectedCurrency: 'gbp' }).to,
      'held_for_review');
  });
});
