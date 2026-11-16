import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripeClient } from './src/stripeClient.mjs';

/**
 * The encoder, mostly. Stripe takes form-encoded nested objects, and getting
 * that subtly wrong is how an amount or an idempotency key silently fails to
 * arrive — with a 200 back, because Stripe just uses its defaults instead.
 */

describe('no key, no client', () => {
  test('returns null so the deposit route can ship inert', () => {
    // Which is how the route exists on a deployment that has not opted into
    // taking money, rather than existing and being broken.
    assert.equal(stripeClient({}), null);
    assert.equal(stripeClient({ STRIPE_SECRET_KEY: '' }), null);
    assert.ok(stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' }));
  });
});

describe('what actually goes on the wire', () => {
  /** Captures the request without sending it. */
  function capture() {
    const seen = {};
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.url = url; seen.init = init;
      return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout' }) };
    };
    return { seen, restore: () => { globalThis.fetch = real; } };
  }

  test('nests objects and arrays the way Stripe parses them', async () => {
    const { seen, restore } = capture();
    try {
      await stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' }).createCheckoutSession({
        mode: 'payment',
        payment_method_types: ['card'],
        payment_intent_data: { metadata: { iris_booking_id: 'bk_1' } },
        line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: 4500 } }],
      });
    } finally { restore(); }

    const body = seen.init.body;
    assert.match(body, /mode=payment/);
    assert.match(body, /payment_method_types\[0\]=card/);
    assert.match(body, /payment_intent_data\[metadata\]\[iris_booking_id\]=bk_1/);
    assert.match(body, /line_items\[0\]\[price_data\]\[unit_amount\]=4500/);
  });

  test('sends the idempotency key as a header, not a field', async () => {
    // As a field it is silently ignored, and every retry becomes a new session
    // — which is a second charge.
    const { seen, restore } = capture();
    try {
      await stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' })
        .createCheckoutSession({ mode: 'payment', idempotency_key: 'deposit:bk_1' });
    } finally { restore(); }

    assert.equal(seen.init.headers['idempotency-key'], 'deposit:bk_1');
    assert.doesNotMatch(seen.init.body, /idempotency_key/);
  });

  test('drops null and undefined rather than sending the strings', async () => {
    const { seen, restore } = capture();
    try {
      await stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' })
        .createCheckoutSession({ mode: 'payment', customer: null, locale: undefined });
    } finally { restore(); }
    assert.doesNotMatch(seen.init.body, /customer|locale/);
  });

  test('a Stripe error is raised, not returned as a session', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false, status: 402, json: async () => ({ error: { message: 'Your card was declined.' } }),
    });
    try {
      await assert.rejects(
        () => stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' }).createCheckoutSession({ mode: 'payment' }),
        /declined/,
      );
    } finally { globalThis.fetch = real; }
  });
});

describe('when a deployment may take a deposit', () => {
  test('needs the webhook secret as well as the key', async () => {
    // A key alone can create a Checkout Session but can never be told it was
    // paid. Advertising deposits in that state takes money for bookings that
    // never confirm — which is what the live service was doing.
    const { depositsEnabled } = await import('./src/stripeClient.mjs');
    assert.equal(depositsEnabled({ STRIPE_SECRET_KEY: 'sk_test_x' }), false);
    assert.equal(depositsEnabled({ STRIPE_WEBHOOK_SECRET: 'whsec_x' }), false);
    assert.equal(depositsEnabled({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }), true);
  });

  test('a placeholder is not a secret', async () => {
    const { depositsEnabled, webhookSecrets } = await import('./src/stripeClient.mjs');
    assert.equal(depositsEnabled({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'unset' }), false);
    assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: 'unset' }), []);
  });

  test('holds both secrets during a rotation', async () => {
    const { webhookSecrets } = await import('./src/stripeClient.mjs');
    assert.deepEqual(webhookSecrets({ STRIPE_WEBHOOK_SECRET: 'whsec_old, whsec_new' }), ['whsec_old', 'whsec_new']);
  });
});

describe('reading current truth back', () => {
  test('a session is fetched with its charge refunds expanded', async () => {
    // Since API 2022-11-15 a Charge omits its refunds unless asked, and a FAILED
    // refund is only visible there. Without the expand it reads as a success.
    let seen;
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({}) }; };
    try {
      await stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' }).retrieveCheckoutSession('cs_1');
    } finally { globalThis.fetch = real; }
    assert.equal(seen.init.method, 'GET');
    assert.equal(seen.init.body, undefined);
    assert.match(decodeURIComponent(seen.url), /checkout\/sessions\/cs_1\?.*expand\[\d\]=payment_intent\.latest_charge\.refunds/);
  });

  test('a refund carries its idempotency key as a header', async () => {
    let seen;
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ id: 're_1' }) }; };
    try {
      await stripeClient({ STRIPE_SECRET_KEY: 'sk_test_x' })
        .createRefund({ payment_intent: 'pi_1', amount: 2250, idempotency_key: 'refund_deposit:bk_1' });
    } finally { globalThis.fetch = real; }
    assert.match(seen.url, /\/v1\/refunds$/);
    assert.equal(seen.init.headers['idempotency-key'], 'refund_deposit:bk_1');
    assert.match(seen.init.body, /payment_intent=pi_1&amount=2250/);
  });

  test('a refusal that will never succeed is marked permanent; rate limiting is not', async () => {
    const real = globalThis.fetch;
    const fail = (status) => { globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ error: { message: 'no' } }) }); };
    try {
      fail(400);
      await assert.rejects(() => stripeClient({ STRIPE_SECRET_KEY: 'k' }).createRefund({}), (e) => e.permanent === true);
      fail(429);
      await assert.rejects(() => stripeClient({ STRIPE_SECRET_KEY: 'k' }).createRefund({}), (e) => e.permanent === false);
      // A rotated or briefly wrong key, or a request still in progress, will pass.
      for (const status of [401, 403, 409]) {
        fail(status);
        await assert.rejects(() => stripeClient({ STRIPE_SECRET_KEY: 'k' }).createRefund({}), (e) => e.permanent === false);
      }
      fail(503);
      await assert.rejects(() => stripeClient({ STRIPE_SECRET_KEY: 'k' }).createRefund({}), (e) => e.permanent === false);
    } finally { globalThis.fetch = real; }
  });
});
