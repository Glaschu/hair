import { testDb, wipe, closeDb } from './src/testDb.mjs';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { route } from './src/routes.mjs';
import { sign } from './src/stripeWebhook.mjs';
import { drainOutbox } from './src/drainOutbox.mjs';
import { refundSender } from './src/refunds.mjs';

/** Shaped like the booking page's sealed box; its contents are only ever opened on her devices. */
const ENVELOPE = Buffer.alloc(120, 7).toString('base64');

/**
 * The money path, end to end, through the routes the deployment actually
 * serves.
 *
 * This file exists because every piece of the deposit path had its own green
 * tests and the whole never worked: the deployed service advertised deposits
 * with no webhook route, a paid deposit never took its slot, and a hold that
 * lapsed mid-payment sold the same hour twice. Each of those lived in a seam
 * between pieces, and only a test that crosses the seams can see one.
 *
 * Stripe is faked STATEFULLY — sessions, payment intents, charges and refunds
 * that change as the client pays and she refunds — and webhooks are signed
 * exactly as Stripe signs them, so they go through the real door.
 */

let db, app, FieldValue;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ENV = { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_old, whsec_new' };

before(() => { ({ db, app, FieldValue } = testDb('iris-money-test')); });
after(async () => { await closeDb(app); });

/** A Stripe that remembers, so refunds and late payments behave as they do for real. */
function fakeStripe() {
  const sessions = new Map();
  const refunds = [];
  let n = 0;

  const intentOf = (s) => ({
    id: s.pi,
    object: 'payment_intent',
    status: s.payment_status === 'paid' ? 'succeeded' : 'requires_payment_method',
    amount: s.amount_total,
    amount_received: s.payment_status === 'paid' ? s.amount_total : 0,
    currency: 'gbp',
    metadata: s.metadata,
    latest_charge: s.payment_status === 'paid'
      ? {
          id: `ch_${s.pi}`, disputed: !!s.disputed,
          amount_refunded: refunds.filter((r) => r.payment_intent === s.pi).reduce((t, r) => t + r.amount, 0),
          refunds: { data: refunds.filter((r) => r.payment_intent === s.pi).map((r) => ({ status: 'succeeded', amount: r.amount })) },
        }
      : null,
  });

  return {
    sessions, refunds,
    async createCheckoutSession(params) {
      const id = `cs_${++n}`;
      sessions.set(id, {
        id, params, url: `https://checkout.stripe.test/${id}`,
        payment_status: 'unpaid', status: 'open',
        amount_total: params.line_items[0].price_data.unit_amount,
        currency: 'gbp', client_reference_id: params.client_reference_id,
        pi: `pi_${n}`, metadata: params.payment_intent_data.metadata,
      });
      return { id, url: sessions.get(id).url };
    },
    async retrieveCheckoutSession(id) {
      const s = sessions.get(id);
      return {
        id: s.id, object: 'checkout.session', status: s.status, payment_status: s.payment_status,
        amount_total: s.amount_total, currency: s.currency,
        client_reference_id: s.client_reference_id, payment_intent: intentOf(s),
      };
    },
    async retrievePaymentIntent(id) {
      return intentOf([...sessions.values()].find((s) => s.pi === id));
    },
    async expireCheckoutSession(id) {
      // As Stripe: only an open session can be expired.
      if (sessions.get(id).status !== 'open') throw Object.assign(new Error('session is not open'), { status: 400 });
      sessions.get(id).status = 'expired';
    },
    async createRefund({ idempotency_key: key, ...params }) {
      if (this.refusesRefunds) {
        throw Object.assign(new Error('This key does not have permission to create refunds.'), { permanent: true, status: 403 });
      }
      // Stripe's idempotency: the same key is the same refund.
      if (!refunds.some((r) => r.key === key)) refunds.push({ key, ...params });
      return { id: `re_${refunds.length}` };
    },
    /** The client's bank opens a dispute. */
    dispute(id) { sessions.get(id).disputed = true; },
    /** The client completes the payment page. Impossible once it has expired. */
    pay(id) {
      if (sessions.get(id).status !== 'open') throw new Error('cannot pay an expired session');
      sessions.get(id).payment_status = 'paid'; sessions.get(id).status = 'complete';
    },
    /** Stripe ending a session nobody finished. */
    lapse(id) { sessions.get(id).status = 'expired'; },
  };
}

let stripe;
beforeEach(async () => {
  await wipe(db);
  await db.doc('salon/me').set({ name: 'Jessie', publicKey: 'pk-base64' });
  await db.doc('config/access').set({ uids: ['u-jessie', 'u-anon'] });
  stripe = fakeStripe();
});

/** A request as Firebase hands it to the function. */
function req(method, path, { body, raw, headers = {} } = {}) {
  const h = { host: 'jessie-salon.web.app', ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
  return { method, path, body, rawBody: raw === undefined ? undefined : Buffer.from(raw), get: (k) => h[k.toLowerCase()] };
}

const call = (method, path, opts = {}, { now = NOW, env = ENV } = {}) => route(req(method, path, opts), {
  db, env, stripe, FieldValue, now,
  verify: async (token) => {
    const known = {
      'token-jessie': { uid: 'u-jessie', auth_time: Math.floor(now / 1000) - 60 },
      'token-jessie-stale': { uid: 'u-jessie', auth_time: Math.floor(now / 1000) - 3 * 3600 },
      'token-stranger': { uid: 'u-someone' },
      'token-anon': { uid: 'u-anon', firebase: { sign_in_provider: 'anonymous' } },
    };
    if (!known[token]) throw new Error('bad token');
    return known[token];
  },
});

/** Stripe telling us about a session, signed the way Stripe signs. */
function webhook(sessionId, { type = 'checkout.session.completed', id = `evt_${Math.random()}`, secret = 'whsec_new', now = NOW } = {}) {
  const raw = JSON.stringify({ id, type, data: { object: { object: 'checkout.session', id: sessionId } } });
  const t = Math.floor(now / 1000);
  return call('POST', '/api/stripe/webhook', { raw, headers: { 'stripe-signature': `t=${t},v1=${sign(raw, secret, t)}` } }, { now });
}

async function link({ startsIn = 72 * HOUR, price = 9000, max = 1 } = {}) {
  // The terms the client agrees to: her default 48h / 24h schedule.
  await db.doc('policies/pol1').set({ text: 'Give 48 hours notice.', createdAt: NOW });
  await db.doc('links/tok1').set({
    clientRef: 'ref-1', serviceName: 'Full head colour', durationMins: 180, priceMinor: price,
    tz: 'Europe/London', policyId: 'pol1', createdAt: NOW, expiresAt: NOW + 21 * 24 * HOUR,
    revoked: false, maxBookings: max, bookedCount: 0,
    slots: [{ id: 's0', s: NOW + startsIn, e: NOW + startsIn + 3 * HOUR, taken: false }],
  });
}

const deposit = (over = {}, when) => call('POST', '/api/l/tok1/deposit', {
  body: { slotId: 's0', sealed: ENVELOPE, agreed: true, requestId: `req-${Math.random()}`, ...over },
}, when);

const sessionOf = (bookingId) => [...stripe.sessions.values()].find((s) => s.client_reference_id === bookingId);
const bookingDoc = async (id) => (await db.doc(`bookings/${id}`).get()).data();
const slot = async () => (await db.doc('links/tok1').get()).data().slots[0];
const inbox = async () => (await db.collection('bookings')
  .where('status', '==', 'confirmed').where('seenAt', '==', null).get()).docs;
const outboxKinds = async () => (await db.collection('outbox').get()).docs.map((d) => d.data().kind).sort();

describe('a deposit, from the page to her inbox', () => {
  test('the whole path works, once', async () => {
    await link();
    assert.ok((await call('GET', '/api/version')).body.capabilities.includes('deposits'));
    assert.equal((await call('GET', '/api/l/tok1')).body.depositMinor, 4500);

    const started = await deposit();
    assert.equal(started.status, 200);
    const { bookingId, cancelToken, checkoutUrl } = started.body;
    assert.match(checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);

    const params = sessionOf(bookingId).params;
    assert.equal(params.success_url, `https://jessie-salon.web.app/b/tok1?paid=1&c=${cancelToken}`);
    assert.equal(params.cancel_url, `https://jessie-salon.web.app/b/tok1?back=1&c=${cancelToken}`);
    assert.ok(params.expires_at * 1000 >= NOW + 31 * MIN, 'clear of Stripe’s 30-minute floor');

    // Held: nobody else is offered it while they pay.
    assert.deepEqual((await call('GET', '/api/l/tok1')).body.slots, []);
    assert.equal((await deposit()).status, 409);

    // Back from Stripe before paying: still waiting, not confirmed.
    assert.equal((await call('POST', `/api/c/${cancelToken}/check`)).body.status, 'pending_payment');
    assert.equal((await inbox()).length, 0, 'nothing reaches her diary unpaid');

    stripe.pay(sessionOf(bookingId).id);
    const deliveries = [];
    for (let i = 0; i < 3; i++) deliveries.push(await webhook(sessionOf(bookingId).id, { id: 'evt_paid' }));
    assert.deepEqual(deliveries.map((d) => d.body.action), ['applied', 'duplicate', 'duplicate']);

    const b = await bookingDoc(bookingId);
    assert.equal(b.status, 'confirmed');
    assert.equal(b.sealed, ENVELOPE, 'she can see who is coming');
    assert.equal(b.stripe.paymentIntentId, sessionOf(bookingId).pi, 'and it can be refunded');
    assert.equal((await slot()).taken, true);
    assert.equal((await slot()).takenBy, bookingId);
    assert.equal((await db.doc('links/tok1').get()).data().bookedCount, 1);

    const waiting = await inbox();
    assert.equal(waiting.length, 1, 'it reaches her inbox');
    assert.equal(waiting[0].id, bookingId);

    assert.equal((await call('POST', `/api/c/${cancelToken}/check`)).body.status, 'confirmed');
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist'], 'and nobody is told twice');
  });

  test('a free booking cannot go round the deposit', async () => {
    await link();
    const out = await call('POST', '/api/l/tok1/book', { body: { slotId: 's0', sealed: ENVELOPE, agreed: true } });
    assert.equal(out.status, 402);
  });

  test('a free booking cannot take an hour someone is paying for', async () => {
    // Deposits switched off mid-checkout — the free path must still respect the hold.
    await link();
    await deposit();
    const out = await call('POST', '/api/l/tok1/book', { body: { slotId: 's0', sealed: ENVELOPE, agreed: true } },
      { env: { STRIPE_SECRET_KEY: 'sk_test_fake' } });
    assert.equal(out.status, 409);
  });

  test('a double press is one checkout, not a "someone took your time"', async () => {
    await link();
    const first = await deposit({ requestId: 'req-same' });
    const again = await deposit({ requestId: 'req-same' });
    assert.equal(again.status, 200);
    assert.equal(again.body.checkoutUrl, first.body.checkoutUrl);
    assert.equal(stripe.sessions.size, 1);
    assert.equal((await db.collection('bookings').get()).size, 1);
  });
});

describe('when the webhook never arrives', () => {
  test('the client coming back is enough — the server asks Stripe', async () => {
    // A wrong webhook secret, or Stripe delivery delayed. The return page does
    // not trust the redirect; it asks the server, which asks Stripe.
    await link();
    const { body } = await deposit();
    stripe.pay(sessionOf(body.bookingId).id);

    const back = await call('POST', `/api/c/${body.cancelToken}/check`);
    assert.equal(back.body.status, 'confirmed');
    assert.equal((await inbox()).length, 1);

    // The webhook turning up later changes nothing and tells nobody twice.
    await webhook(sessionOf(body.bookingId).id);
    assert.deepEqual(await outboxKinds(), ['confirm_client', 'notify_stylist']);
    assert.equal((await db.doc('links/tok1').get()).data().bookedCount, 1);
  });
});

describe('when a hold lapses while someone is still paying', () => {
  test('the hour is sold once, and the late payer is refunded in full', async () => {
    await link();
    const a = (await deposit()).body;

    // A's hold lapses. B starts and pays.
    const later = NOW + 43 * MIN;
    const b = (await deposit({}, { now: later })).body;
    assert.ok(b.bookingId, 'the hour is genuinely free again once the hold has lapsed');
    stripe.pay(sessionOf(b.bookingId).id);
    await webhook(sessionOf(b.bookingId).id, { now: later });

    // A finishes paying, late.
    stripe.pay(sessionOf(a.bookingId).id);
    await webhook(sessionOf(a.bookingId).id, { now: later + MIN });

    assert.equal((await bookingDoc(b.bookingId)).status, 'confirmed');
    assert.equal((await bookingDoc(a.bookingId)).status, 'slot_lost');
    assert.equal((await slot()).takenBy, b.bookingId, 'one hour, one client');
    assert.deepEqual((await inbox()).map((d) => d.id), [b.bookingId]);

    const refund = (await db.doc(`outbox/refund_deposit:${a.bookingId}`).get()).data();
    assert.equal(refund.amountMinor, 4500);
    assert.equal(refund.paymentIntentId, sessionOf(a.bookingId).pi);

    // What A sees on the return page.
    const seen = await call('POST', `/api/c/${a.cancelToken}/check`, {}, { now: later + MIN });
    assert.equal(seen.body.status, 'slot_lost');
  });
});

describe('cancelling gives back what the page promised', () => {
  async function confirmedBooking(startsIn) {
    await link({ startsIn });
    const { body } = await deposit();
    stripe.pay(sessionOf(body.bookingId).id);
    await webhook(sessionOf(body.bookingId).id);
    return body;
  }

  const drain = () => drainOutbox(db, { kind: 'refund_deposit', send: refundSender(db, stripe), now: NOW + MIN });

  test('with two days notice, the whole deposit — refunded once however often the drain runs', async () => {
    const { bookingId, cancelToken } = await confirmedBooking(72 * HOUR);

    const preview = await call('GET', `/api/c/${cancelToken}`);
    assert.equal(preview.body.refundPct, 100);
    assert.equal(preview.body.depositMinor, 4500);

    assert.equal((await call('POST', `/api/c/${cancelToken}`)).status, 200);
    assert.equal((await slot()).taken, false, 'the hour goes back on sale');

    await drain();
    await drain();
    assert.equal(stripe.refunds.length, 1);
    assert.equal(stripe.refunds[0].amount, 4500);
    assert.equal(stripe.refunds[0].payment_intent, sessionOf(bookingId).pi);

    // Stripe then tells us about the refund, and the money story closes.
    const refunded = JSON.stringify({ id: 'evt_ref', type: 'charge.refunded', data: { object: { object: 'charge', payment_intent: sessionOf(bookingId).pi } } });
    const t = Math.floor(NOW / 1000);
    await call('POST', '/api/stripe/webhook', { raw: refunded, headers: { 'stripe-signature': `t=${t},v1=${sign(refunded, 'whsec_new', t)}` } });
    const b = await bookingDoc(bookingId);
    assert.equal(b.classification, 'refunded');
    assert.equal(b.status, 'cancelled');
  });

  test('with a day and a half, half of it', async () => {
    const { cancelToken } = await confirmedBooking(36 * HOUR);
    await call('POST', `/api/c/${cancelToken}`);
    await drain();
    assert.equal(stripe.refunds[0].amount, 2250);
  });

  test('inside a day, nothing comes back — and nothing is queued', async () => {
    const { cancelToken } = await confirmedBooking(12 * HOUR);
    await call('POST', `/api/c/${cancelToken}`);
    await drain();
    assert.equal(stripe.refunds.length, 0);
    assert.deepEqual(await outboxKinds(), ['cancel_notice', 'confirm_client', 'notify_stylist']);
  });

  test('cannot cancel a booking that is still at Stripe', async () => {
    await link();
    const { cancelToken } = (await deposit()).body;
    assert.equal((await call('POST', `/api/c/${cancelToken}`)).status, 409);
  });
});

describe('the door', () => {
  test('refuses a bad signature, and a secret that is not one of ours', async () => {
    await link();
    const { bookingId } = (await deposit()).body;
    stripe.pay(sessionOf(bookingId).id);
    assert.equal((await webhook(sessionOf(bookingId).id, { secret: 'whsec_attacker' })).status, 400);
    assert.equal((await bookingDoc(bookingId)).status, 'pending_payment');
  });

  test('accepts both secrets while one is being rotated', async () => {
    await link();
    const { bookingId } = (await deposit()).body;
    stripe.pay(sessionOf(bookingId).id);
    assert.equal((await webhook(sessionOf(bookingId).id, { secret: 'whsec_old' })).status, 200);
    assert.equal((await bookingDoc(bookingId)).status, 'confirmed');
  });

  test('with the key but no webhook secret, deposits are not offered and free booking works', async () => {
    // Exactly the state the live service was in: key set, no webhook.
    const keyOnly = { env: { STRIPE_SECRET_KEY: 'sk_test_fake' } };
    await link();
    assert.ok(!(await call('GET', '/api/version', {}, keyOnly)).body.capabilities.includes('deposits'));
    assert.equal((await call('GET', '/api/l/tok1', {}, keyOnly)).body.depositMinor, null);
    assert.equal((await call('POST', '/api/l/tok1/deposit', { body: { slotId: 's0', sealed: ENVELOPE } }, keyOnly)).status, 501);
    const booked = await call('POST', '/api/l/tok1/book', { body: { slotId: 's0', sealed: ENVELOPE, agreed: true } }, keyOnly);
    assert.equal(booked.status, 200);
  });
});

describe('her devices, on this deployment', () => {
  const as = (token, method, path, body, headers = {}) =>
    call(method, path, { body, headers: { authorization: `Bearer ${token}`, ...headers } });

  test('nobody gets in without a token, a stranger is turned away, and so is anonymous sign-in', async () => {
    assert.equal((await call('GET', '/api/salon')).status, 401);
    assert.equal((await as('garbage', 'GET', '/api/salon')).status, 401);
    assert.equal((await as('token-stranger', 'GET', '/api/salon')).status, 403);
    assert.equal((await as('token-anon', 'GET', '/api/salon')).status, 403);
    assert.equal((await as('token-jessie', 'GET', '/api/salon')).status, 200);
  });

  test('the salon key is write-once without a fresh sign-in', async () => {
    await db.doc('salon/me').delete();
    assert.equal((await as('token-jessie', 'GET', '/api/salon')).status, 404);
    assert.equal((await as('token-jessie', 'PUT', '/api/salon', { name: 'Jessie', publicKey: 'pk-1' })).status, 200);
    assert.equal((await as('token-jessie', 'PUT', '/api/salon', { name: 'Jessie', publicKey: 'pk-1' })).status, 200, 'same key again is harmless');

    assert.equal((await as('token-jessie', 'PUT', '/api/salon', { name: 'J', publicKey: 'pk-2' })).status, 409);
    assert.equal((await as('token-jessie-stale', 'PUT', '/api/salon', { name: 'J', publicKey: 'pk-2' }, { 'x-iris-reset': 'confirm' })).status, 409,
      'an old sign-in is not enough to redirect her bookings');
    assert.equal((await as('token-jessie', 'PUT', '/api/salon', { name: 'J', publicKey: 'pk-2' }, { 'x-iris-reset': 'confirm' })).status, 200);
  });

  test('she can make a link, two links cannot offer one hour, and she can revoke one', async () => {
    await as('token-jessie', 'PUT', '/api/salon', { name: 'Jessie', publicKey: 'pk-base64', policy: 'Give 48 hours notice.' });
    const slot = { startsAt: new Date(NOW + 72 * HOUR).toISOString(), endsAt: new Date(NOW + 75 * HOUR).toISOString() };
    const made = await as('token-jessie', 'POST', '/api/links', { clientRef: 'r1', serviceName: 'Cut', slots: [slot] });
    assert.equal(made.status, 200);
    assert.equal(made.body.url, `https://jessie-salon.web.app/b/${made.body.token}`);
    assert.ok((await call('GET', `/api/l/${made.body.token}`)).body.policy, 'her policy is pinned to it');

    assert.equal((await as('token-jessie', 'POST', '/api/links', { clientRef: 'r2', serviceName: 'Cut', slots: [slot] })).status, 409);

    assert.equal((await as('token-jessie', 'DELETE', `/api/links/${made.body.token}`)).status, 200);
    assert.equal((await call('GET', `/api/l/${made.body.token}`)).status, 404);
  });
});

describe('backing out of Stripe', () => {
  test('gives the hour back at once, and nobody can pay into that checkout afterwards', async () => {
    // Before, the hold sat there for forty minutes and the client who backed
    // out to pick another time was told every time had gone.
    await link();
    const { bookingId, cancelToken } = (await deposit()).body;
    assert.deepEqual((await call('GET', '/api/l/tok1')).body.slots, [], 'held while they are at Stripe');

    const back = await call('POST', `/api/c/${cancelToken}/release`);
    assert.equal(back.body.status, 'expired');
    assert.equal((await call('GET', '/api/l/tok1')).body.slots.length, 1, 'the hour is back on offer');
    assert.throws(() => stripe.pay(sessionOf(bookingId).id), /expired/);

    // And they can start again straight away.
    assert.equal((await deposit()).status, 200);
  });

  test('if they had in fact paid — in another tab — it confirms instead of releasing', async () => {
    await link();
    const { bookingId, cancelToken } = (await deposit()).body;
    stripe.pay(sessionOf(bookingId).id);

    const back = await call('POST', `/api/c/${cancelToken}/release`);
    assert.equal(back.body.status, 'confirmed');
    assert.equal((await slot()).takenBy, bookingId);
  });

  test("Stripe's own expiry closes the booking and frees the hour too", async () => {
    await link();
    const { bookingId } = (await deposit()).body;
    stripe.lapse(sessionOf(bookingId).id);
    await webhook(sessionOf(bookingId).id, { type: 'checkout.session.expired' });

    const b = await bookingDoc(bookingId);
    assert.equal(b.status, 'expired');
    assert.equal(b.classification, 'closed');
    assert.equal((await slot()).heldBy ?? null, null);
    assert.deepEqual(await outboxKinds(), [], 'and nobody is told anything');
  });
});

describe('when a client cancels from their link', () => {
  test('the cancellation goes back into her inbox, so her diary hears about it', async () => {
    await link();
    const { bookingId, cancelToken } = (await deposit()).body;
    stripe.pay(sessionOf(bookingId).id);
    await webhook(sessionOf(bookingId).id);
    // Her phone pulls it in and acknowledges it.
    await db.doc(`bookings/${bookingId}`).update({ seenAt: NOW, version: 1 });

    await call('POST', `/api/c/${cancelToken}`);
    const back = (await db.collection('bookings').where('seenAt', '==', null).get()).docs;
    assert.deepEqual(back.map((d) => [d.id, d.data().status]), [[bookingId, 'cancelled']]);
  });
});

describe('found in review', () => {
  test('backing out and trying again from the same page starts a fresh checkout', async () => {
    // The page keeps one requestId for its life, and backing out no longer
    // reloads it. Resuming the abandoned checkout told the client their
    // booking was "no longer active" until they refreshed.
    await link();
    const first = (await deposit({ requestId: 'page-1' })).body;
    await call('POST', `/api/c/${first.cancelToken}/release`);

    const again = await deposit({ requestId: 'page-1' });
    assert.equal(again.status, 200);
    assert.ok(again.body.checkoutUrl, 'a real checkout, not a resumed dead one');
    assert.notEqual(again.body.bookingId, first.bookingId);
  });

  test('a forged Host header cannot choose where a payer is sent', async () => {
    await link();
    const forged = await route(req('POST', '/api/l/tok1/deposit', {
      body: { slotId: 's0', sealed: ENVELOPE, agreed: true },
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
    }), { db, env: { ...ENV, GCLOUD_PROJECT: 'jessie-salon' }, stripe, FieldValue, now: NOW });
    assert.equal(forged.status, 200);
    const params = sessionOf(forged.body.bookingId).params;
    assert.match(params.success_url, /^https:\/\/jessie-salon\.web\.app\//);
    assert.match(params.cancel_url, /^https:\/\/jessie-salon\.web\.app\//);
  });

  test('the real address — and a listed custom domain — are believed', async () => {
    const { originOf } = await import('./src/routes.mjs');
    const env = { GCLOUD_PROJECT: 'jessie-salon', PUBLIC_HOSTS: 'book.jessiehair.co.uk' };
    const at = (host) => originOf({ get: (h) => (h === 'x-forwarded-host' ? host : undefined) }, env);
    assert.equal(at('jessie-salon.web.app'), 'https://jessie-salon.web.app');
    assert.equal(at('book.jessiehair.co.uk'), 'https://book.jessiehair.co.uk');
    assert.equal(at('evil.example'), 'https://book.jessiehair.co.uk');
    // A prefix test once let these through.
    assert.equal(at('localhost.evil.com'), 'https://book.jessiehair.co.uk');
    assert.equal(at('127.evil.com'), 'https://book.jessiehair.co.uk');
    assert.equal(at('localhost:5055'), 'https://book.jessiehair.co.uk', 'local only under the emulator');
    const emu = { ...env, FUNCTIONS_EMULATOR: 'true' };
    const local = (host) => originOf({ get: (h) => (h === 'host' ? host : undefined) }, emu);
    assert.equal(local('localhost:5055'), 'http://localhost:5055');
    assert.equal(local('localhost.evil.com'), 'https://book.jessiehair.co.uk');
  });

  test('junk instead of an envelope takes no hour and never reaches her inbox', async () => {
    // Her phone cannot open junk, and an unopenable booking is never
    // acknowledged — so one bad request used to sit in her inbox for good.
    await link({ price: 0 });
    for (const sealed of ['x', 'not base64 at all!', Buffer.alloc(10).toString('base64'), { an: 'object' }]) {
      const out = await call('POST', '/api/l/tok1/book', { body: { slotId: 's0', sealed, agreed: true } });
      assert.equal(out.status, 400, `refused: ${JSON.stringify(sealed)}`);
    }
    assert.equal((await slot()).taken, false);
    assert.equal((await db.collection('bookings').get()).size, 0);
  });
});

describe('her cancelling a web booking from her diary', () => {
  const as = (method, path, body) =>
    call(method, path, { body, headers: { authorization: 'Bearer token-jessie' } });

  async function paidBooking(startsIn) {
    await link({ startsIn });
    const { body } = await deposit();
    stripe.pay(sessionOf(body.bookingId).id);
    await webhook(sessionOf(body.bookingId).id);
    // Her phone has pulled it in.
    await db.doc(`bookings/${body.bookingId}`).update({ seenAt: NOW, version: 1 });
    return body;
  }
  const drain = () => drainOutbox(db, { kind: 'refund_deposit', send: refundSender(db, stripe), now: NOW + MIN });

  test('she sees what is at stake before choosing', async () => {
    const { bookingId } = await paidBooking(36 * HOUR);
    const preview = await as('GET', `/api/bookings/${bookingId}/cancel`);
    assert.deepEqual(preview.body, {
      status: 'confirmed', depositMinor: 4500, noticeMs: 36 * HOUR, policyRefundPct: 50,
    });
  });

  test('calling it off herself gives the whole deposit back, however late', async () => {
    const { bookingId } = await paidBooking(12 * HOUR);
    const out = await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'full' });
    assert.equal(out.body.refundMinor, 4500);
    await drain();
    assert.equal(stripe.refunds[0].amount, 4500);

    const b = await bookingDoc(bookingId);
    assert.equal(b.cancelledBy, 'salon');
    assert.equal(b.seenAt, NOW, 'not sent back to her inbox — she did it');
  });

  test('when the client asked, their schedule applies — at the notice they gave her', async () => {
    // She cancelled at 50 hours' notice with no signal; the request only
    // reached the service 14 hours later, at 36. The client gave 50 hours, so
    // the whole deposit comes back.
    const { bookingId } = await paidBooking(50 * HOUR);
    const out = await call('POST', `/api/bookings/${bookingId}/cancel`, {
      body: { refund: 'policy', cancelledAt: NOW },
      headers: { authorization: 'Bearer token-jessie' },
    }, { now: NOW + 14 * HOUR });
    assert.equal(out.body.refundPct, 100);
  });

  test('…and with a day and a half of notice, half', async () => {
    const { bookingId } = await paidBooking(36 * HOUR);
    const half = await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'policy' });
    assert.equal(half.body.refundMinor, 2250);
  });

  test('notice can never be dated before the booking existed', async () => {
    const { bookingId } = await paidBooking(36 * HOUR);
    const out = await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'policy', cancelledAt: NOW - 30 * 24 * HOUR });
    assert.equal(out.body.refundPct, 50, 'clamped to when it was booked, not a month earlier');
  });

  test('the hour comes back for other clients, but is not offered to the same link again', async () => {
    const { bookingId } = await paidBooking(72 * HOUR);
    await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'full' });

    assert.equal((await call('GET', '/api/l/tok1')).status, 404, 'the old link is withdrawn');
    const again = await as('POST', '/api/links', {
      clientRef: 'r2', serviceName: 'Colour',
      slots: [{ startsAt: new Date(NOW + 72 * HOUR).toISOString(), endsAt: new Date(NOW + 75 * HOUR).toISOString() }],
    });
    assert.equal(again.status, 200, 'and the hour can go to someone else');
  });

  test('twice is once: no second refund, no error', async () => {
    const { bookingId } = await paidBooking(72 * HOUR);
    await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'full' });
    const second = await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'full' });
    assert.equal(second.body.alreadyCancelled, true);
    await drain();
    assert.equal(stripe.refunds.length, 1);
  });

  test('only she can do it, and only with a real choice', async () => {
    const { bookingId } = await paidBooking(72 * HOUR);
    assert.equal((await call('POST', `/api/bookings/${bookingId}/cancel`, { body: { refund: 'full' } })).status, 401);
    assert.equal((await as('POST', `/api/bookings/${bookingId}/cancel`, { refund: 'all of it' })).status, 400);
    assert.equal((await as('POST', '/api/bookings/nope/cancel', { refund: 'full' })).status, 404);
  });
});

describe('her own refund schedule', () => {
  const as = (method, path, body) =>
    call(method, path, { body, headers: { authorization: 'Bearer token-jessie' } });
  const slot72 = () => [{ startsAt: new Date(NOW + 36 * HOUR).toISOString(), endsAt: new Date(NOW + 39 * HOUR).toISOString() }];

  test('is what a new link pins, shows, and refunds by', async () => {
    const tiers = [{ minNoticeHours: 72, refundPct: 100 }, { minNoticeHours: 24, refundPct: 25 }, { minNoticeHours: 0, refundPct: 0 }];
    assert.equal((await as('PUT', '/api/salon', { name: 'Jessie', publicKey: 'pk-base64', policy: 'Three days, please.', tiers })).status, 200);
    assert.deepEqual((await as('GET', '/api/salon')).body.tiers, tiers);

    const made = (await as('POST', '/api/links', { clientRef: 'r1', serviceName: 'Colour', priceMinor: 9000, slots: slot72() })).body;
    const view = (await call('GET', `/api/l/${made.token}`)).body;
    assert.deepEqual(view.refundTiers, tiers, 'the client is shown the numbers, not just the words');

    const { body } = await call('POST', `/api/l/${made.token}/deposit`, {
      body: { slotId: view.slots[0].id, sealed: ENVELOPE, agreed: true },
    });
    stripe.pay(sessionOf(body.bookingId).id);
    await webhook(sessionOf(body.bookingId).id);
    const out = await call('POST', `/api/c/${body.cancelToken}`);
    assert.equal(out.body.refundPct, 25, '36 hours under her schedule, not the default 50');
  });

  test('a link already sent keeps the terms it was sent with', async () => {
    await as('PUT', '/api/salon', { name: 'Jessie', publicKey: 'pk-base64', policy: 'Two days.' });
    const before = (await as('POST', '/api/links', { clientRef: 'r1', serviceName: 'Colour', slots: slot72() })).body;
    await as('PUT', '/api/salon', {
      name: 'Jessie', publicKey: 'pk-base64', policy: 'A week.',
      tiers: [{ minNoticeHours: 168, refundPct: 100 }, { minNoticeHours: 0, refundPct: 0 }],
    });
    const view = (await call('GET', `/api/l/${before.token}`)).body;
    assert.equal(view.policy, 'Two days.');
    assert.equal(view.refundTiers[0].minNoticeHours, 48);
  });

  test('refuses a schedule that is not one', async () => {
    const bad = [
      [{ minNoticeHours: 24, refundPct: 100 }],                                            // never reaches 0 hours
      [{ minNoticeHours: 24, refundPct: 50 }, { minNoticeHours: 48, refundPct: 100 }, { minNoticeHours: 0, refundPct: 0 }], // out of order
      [{ minNoticeHours: 48, refundPct: 50 }, { minNoticeHours: 0, refundPct: 100 }],     // more back for less notice
      [{ minNoticeHours: 0, refundPct: 150 }],
    ];
    for (const tiers of bad) {
      assert.equal((await as('PUT', '/api/salon', { name: 'Jessie', publicKey: 'pk-base64', tiers })).status, 400, JSON.stringify(tiers));
    }
  });
});

describe('money that needs her', () => {
  const as = (method, path) => call(method, path, { headers: { authorization: 'Bearer token-jessie' } });
  const kinds = async () => (await as('GET', '/api/attention')).body.items.map((i) => i.kind);

  async function paid() {
    await link();
    const { body } = await deposit();
    stripe.pay(sessionOf(body.bookingId).id);
    await webhook(sessionOf(body.bookingId).id);
    return body;
  }

  test('a dispute is shown, and can be marked as dealt with', async () => {
    const { bookingId } = await paid();
    assert.deepEqual(await kinds(), []);

    stripe.dispute(sessionOf(bookingId).id);
    const raw = JSON.stringify({ id: 'evt_dispute', type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: sessionOf(bookingId).pi } } });
    const t = Math.floor(NOW / 1000);
    await call('POST', '/api/stripe/webhook', { raw, headers: { 'stripe-signature': `t=${t},v1=${sign(raw, 'whsec_new', t)}` } });

    const { items } = (await as('GET', '/api/attention')).body;
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'disputed');
    assert.equal(items[0].bookingId, bookingId);
    assert.equal(items[0].amountMinor, 4500);

    assert.equal((await as('POST', `/api/attention/${encodeURIComponent(items[0].id)}/dismiss`)).status, 200);
    assert.deepEqual(await kinds(), []);
  });

  test('a refund Stripe would not send is shown with the reason', async () => {
    const { cancelToken } = await paid();
    await call('POST', `/api/c/${cancelToken}`);
    stripe.refusesRefunds = true;
    await drainOutbox(db, { kind: 'refund_deposit', send: refundSender(db, stripe), now: NOW + MIN });

    const { items } = (await as('GET', '/api/attention')).body;
    assert.equal(items[0].kind, 'refund_stuck');
    assert.match(items[0].detail, /permission to create refunds/);
  });

  test('a payment with no booking behind it is shown', async () => {
    await link();
    const { bookingId } = (await deposit()).body;
    stripe.pay(sessionOf(bookingId).id);
    await db.doc(`bookings/${bookingId}`).delete();
    await webhook(sessionOf(bookingId).id);
    assert.deepEqual(await kinds(), ['payment_without_booking']);
  });

  test('is hers alone', async () => {
    assert.equal((await call('GET', '/api/attention')).status, 401);
  });
});

describe('her days off', () => {
  const as = (method, path, body) =>
    call(method, path, { body, headers: { authorization: 'Bearer token-jessie' } });
  // The default link offers one slot 72 hours out; this range covers its day.
  const blockTheDay = () => as('PUT', '/api/days-off', {
    ranges: [{ from: new Date(NOW + 60 * HOUR).toISOString(), to: new Date(NOW + 84 * HOUR).toISOString() }],
  });

  test('a day she blocks disappears from a link already sent, and cannot be paid for', async () => {
    await link();
    assert.equal((await call('GET', '/api/l/tok1')).body.slots.length, 1);
    assert.equal((await blockTheDay()).status, 200);

    assert.deepEqual((await call('GET', '/api/l/tok1')).body.slots, []);
    const dep = await deposit();
    assert.equal(dep.status, 409);
    assert.equal(dep.body.error, 'day_off');
  });

  test('a client already paying when she blocks the day is refunded, not booked', async () => {
    await link();
    const { bookingId } = (await deposit()).body;
    await blockTheDay();
    stripe.pay(sessionOf(bookingId).id);
    await webhook(sessionOf(bookingId).id);

    assert.equal((await bookingDoc(bookingId)).status, 'slot_lost');
    assert.equal((await db.doc(`outbox/refund_deposit:${bookingId}`).get()).data().amountMinor, 4500);
    assert.equal((await inbox()).length, 0, 'nothing lands in her diary on her day off');
  });

  test('opening the day again puts the hour back', async () => {
    await link();
    await blockTheDay();
    await as('PUT', '/api/days-off', { ranges: [] });
    assert.equal((await call('GET', '/api/l/tok1')).body.slots.length, 1);
  });

  test('a new link cannot offer an hour on a day off', async () => {
    await blockTheDay();
    const res = await as('POST', '/api/links', {
      clientRef: 'r1', serviceName: 'Cut',
      slots: [{ startsAt: new Date(NOW + 72 * HOUR).toISOString(), endsAt: new Date(NOW + 73 * HOUR).toISOString() }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'day off');
  });

  test('only she can set them, and only as real ranges', async () => {
    assert.equal((await call('PUT', '/api/days-off', { body: { ranges: [] } })).status, 401);
    const backwards = await as('PUT', '/api/days-off', {
      ranges: [{ from: new Date(NOW + 10 * HOUR).toISOString(), to: new Date(NOW + 5 * HOUR).toISOString() }],
    });
    assert.equal(backwards.status, 400);
  });
});

describe('a time that has already started', () => {
  test('is not offered, and cannot be booked or paid for from a page left open', async () => {
    // A link lives three weeks; it kept offering last Tuesday.
    await link({ startsIn: 2 * HOUR });
    const later = { now: NOW + 3 * HOUR };
    assert.deepEqual((await call('GET', '/api/l/tok1', {}, later)).body.slots, []);
    assert.equal((await deposit({}, later)).status, 409);
    const free = await call('POST', '/api/l/tok1/book', { body: { slotId: 's0', sealed: ENVELOPE, agreed: true } },
      { now: NOW + 3 * HOUR, env: {} });
    assert.equal(free.status, 409);
  });
});

describe('found in the second review', () => {
  const as = (method, path, body) =>
    call(method, path, { body, headers: { authorization: 'Bearer token-jessie' } });

  test('a deposit taken with no policy shown comes back in full, whenever they cancel', async () => {
    // The default 48-hour schedule used to be applied to clients who were never shown it.
    await link({ startsIn: 12 * HOUR });
    await db.doc('links/tok1').update({ policyId: null });
    const { body } = await deposit({ agreed: false });
    stripe.pay(sessionOf(body.bookingId).id);
    await webhook(sessionOf(body.bookingId).id);
    const out = await call('POST', `/api/c/${body.cancelToken}`);
    assert.equal(out.body.refundPct, 100);
  });

  test('two links made at the same moment cannot both offer one hour', async () => {
    const slots = [{ startsAt: new Date(NOW + 72 * HOUR).toISOString(), endsAt: new Date(NOW + 73 * HOUR).toISOString() }];
    const both = await Promise.all([
      as('POST', '/api/links', { clientRef: 'r1', serviceName: 'Cut', slots }),
      as('POST', '/api/links', { clientRef: 'r2', serviceName: 'Cut', slots }),
    ]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  });

  test('old unsent message rows are cleared away, money rows never', async () => {
    const { tidyOutbox, STALE_MESSAGE_MS } = await import('./src/drainOutbox.mjs');
    const old = NOW - STALE_MESSAGE_MS - 1000;
    await db.doc('outbox/confirm_client:a').set({ kind: 'confirm_client', state: 'pending', createdAt: old });
    await db.doc('outbox/refund_deposit:a').set({ kind: 'refund_deposit', state: 'pending', createdAt: old });
    await db.doc('outbox/confirm_client:b').set({ kind: 'confirm_client', state: 'pending', createdAt: NOW });
    assert.deepEqual(await tidyOutbox(db, { now: NOW }), { removed: 1 });
    assert.deepEqual((await db.collection('outbox').get()).docs.map((d) => d.id).sort(),
      ['confirm_client:b', 'refund_deposit:a']);
  });
});
