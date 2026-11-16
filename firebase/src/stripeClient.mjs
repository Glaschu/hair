/**
 * The smallest Stripe client this service needs.
 *
 * Hand-rolled rather than pulling the SDK in: it is a handful of form-encoded
 * requests, and a Cloud Function that starts faster is a booking page that
 * feels quicker.
 *
 * Returns null when no key is configured, which is what makes the deposit route
 * inert on a deployment that has not opted into taking money — rather than
 * present but broken.
 */

/** Stripe wants nested objects form-encoded as a[b][c]=v. */
function encode(params, prefix = '', out = []) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => (typeof item === 'object'
        ? encode(item, `${key}[${i}]`, out)
        : out.push(`${key}[${i}]=${encodeURIComponent(item)}`)));
    } else if (typeof v === 'object') {
      encode(v, key, out);
    } else {
      out.push(`${key}=${encodeURIComponent(v)}`);
    }
  }
  return out;
}

/**
 * The signing secrets for the webhook endpoint, as a list.
 *
 * More than one during a rotation — both are live for the overlap so nothing
 * is dropped while they are swapped — so the secret may hold several,
 * separated by commas or whitespace. Anything that is not a `whsec_` value is
 * ignored rather than trusted: a placeholder must never count as configured.
 */
export function webhookSecrets(env = {}) {
  return String(env.STRIPE_WEBHOOK_SECRET ?? '')
    .split(/[\s,]+/)
    .filter((s) => s.startsWith('whsec_'));
}

/**
 * Whether this deployment may take a deposit.
 *
 * BOTH halves, not just the key. With a key and no webhook secret the service
 * can create a Checkout Session but can never be told it was paid — money is
 * taken and the booking never confirms. Advertising deposits in that state is
 * worse than not offering them, so the key alone is not enough.
 */
export function depositsEnabled(env = {}) {
  return Boolean(env.STRIPE_SECRET_KEY) && webhookSecrets(env).length > 0;
}

/**
 * The expansions that let one fetch answer every question the classifier asks.
 *
 * Since API version 2022-11-15 a Charge no longer carries its refunds unless
 * asked, and a refund that FAILED is only visible there. Without this expand a
 * failed refund reads as a successful one.
 */
const SESSION_EXPAND = ['payment_intent', 'payment_intent.latest_charge', 'payment_intent.latest_charge.refunds'];
const INTENT_EXPAND = ['latest_charge', 'latest_charge.refunds'];

export function stripeClient(env = {}) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;

  async function call(method, path, params = {}, idempotencyKey) {
    const query = method === 'GET' ? encode(params).join('&') : '';
    const res = await fetch(`https://api.stripe.com/v1${path}${query ? `?${query}` : ''}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
        // A retry must never become a second session or a second refund. As a
        // header, not a field — as a field Stripe ignores it.
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(method === 'GET' ? {} : { body: encode(params).join('&') }),
    });
    const body = await res.json();
    if (!res.ok) {
      const err = new Error(body?.error?.message ?? `stripe ${res.status}`);
      // 4xx other than rate limiting will never succeed on retry — a refund for
      // more than was paid, a charge already fully refunded. Marked so the
      // outbox stops retrying and tells her instead.
      // NOT 401/403 (a key being rotated, or briefly wrong), 409 (the same
      // request still in progress) or 429: those pass, and killing a refund on
      // its first try over one of them leaves a client unpaid.
      err.permanent = res.status >= 400 && res.status < 500 && ![401, 403, 409, 429].includes(res.status);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    createCheckoutSession({ idempotency_key: idempotencyKey, ...params }) {
      return call('POST', '/checkout/sessions', params, idempotencyKey);
    },

    /** Current truth for a session, expanded so the classifier sees refunds. */
    retrieveCheckoutSession(id) {
      return call('GET', `/checkout/sessions/${encodeURIComponent(id)}`, { expand: SESSION_EXPAND });
    },

    retrievePaymentIntent(id) {
      return call('GET', `/payment_intents/${encodeURIComponent(id)}`, { expand: INTENT_EXPAND });
    },

    /**
     * Ends a session nobody should pay into — one whose hold could not be
     * written because the hour went while Stripe was answering.
     */
    expireCheckoutSession(id) {
      return call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`);
    },

    createRefund({ idempotency_key: idempotencyKey, ...params }) {
      return call('POST', '/refunds', params, idempotencyKey);
    },
  };
}
