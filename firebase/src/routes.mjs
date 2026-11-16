import {
  version, viewLink, book, cancel, previewCancel, createLink,
  getSalon, putSalon, revokeLink, cancelBySalon, previewSalonCancel, putDaysOff,
} from './bookingApi.mjs';
import { listAttention, dismissAttention } from './attention.mjs';
import { startDeposit } from './deposit.mjs';
import { handleEvent } from './handleEvent.mjs';
import { readEvent } from './stripeWebhook.mjs';
import { depositsEnabled, webhookSecrets } from './stripeClient.mjs';
import { fromCheckoutSession, fromPaymentIntent } from './stripeShape.mjs';
import { stylistFrom } from './stylistAuth.mjs';

/**
 * Every route the Firebase deployment serves, as a plain function of a request.
 *
 * Lives here rather than in `functions/index.js` so the whole path — page,
 * deposit, Stripe's webhook, the inbox her phone reads — can be driven end to
 * end against the emulator. The pieces each had tests; nothing had ever sent a
 * webhook through the deployed routing, which is how a service advertising
 * deposits shipped with no webhook route at all.
 *
 * @param deps.stripe  a client from stripeClient(), or null
 * @param deps.verify  (idToken) => claims — Admin Auth's verifyIdToken
 */
export async function route(req, deps) {
  const { db, env = {}, now = Date.now() } = deps;
  const path = (req.path || '/').replace(/\/+$/, '') || '/';
  const method = req.method;
  let m;

  // ---- public: the booking page ----

  if (path === '/api/version' && method === 'GET') return version(env);

  if ((m = path.match(/^\/api\/l\/([A-Za-z0-9_-]+)$/)) && method === 'GET') {
    return viewLink(db, m[1], now, env);
  }

  if ((m = path.match(/^\/api\/l\/([A-Za-z0-9_-]+)\/deposit$/)) && method === 'POST') {
    const body = req.body ?? {};
    return startDeposit(db, m[1], body.slotId, {
      // Null unless BOTH secrets are set, so a half-configured deployment
      // answers 501 instead of taking money it can never confirm.
      stripe: depositsEnabled(env) ? deps.stripe : null,
      origin: originOf(req, env),
      sealed: body.sealed,
      agreed: !!body.agreed,
      requestId: body.requestId,
      now,
    });
  }

  if ((m = path.match(/^\/api\/l\/([A-Za-z0-9_-]+)\/book$/)) && method === 'POST') {
    return book(db, m[1], req.body, { now, env });
  }

  if ((m = path.match(/^\/api\/c\/([A-Za-z0-9_-]+)$/)) && method === 'GET') {
    return previewCancel(db, m[1], now);
  }

  if ((m = path.match(/^\/api\/c\/([A-Za-z0-9_-]+)$/)) && method === 'POST') {
    return cancel(db, m[1], 'client', now);
  }

  if ((m = path.match(/^\/api\/c\/([A-Za-z0-9_-]+)\/check$/)) && method === 'POST') {
    await checkPayment(db, m[1], deps);
    return previewCancel(db, m[1], now);
  }

  // Back out of Stripe without paying: end that checkout so nobody can pay into
  // it, and give the hour back now rather than in forty minutes — otherwise the
  // client who backed out to pick another time finds every time gone.
  if ((m = path.match(/^\/api\/c\/([A-Za-z0-9_-]+)\/release$/)) && method === 'POST') {
    await checkPayment(db, m[1], deps, { expire: true });
    return previewCancel(db, m[1], now);
  }

  // ---- Stripe ----

  if (path === '/api/stripe/webhook' && method === 'POST') return webhook(req, deps);

  // ---- her devices: an ID token from Firebase Auth ----

  if (path === '/api/salon' || path === '/api/links' || path.startsWith('/api/links/')
      || path.startsWith('/api/bookings/') || path === '/api/attention' || path.startsWith('/api/attention/')
      || path === '/api/days-off') {
    const who = await stylistFrom(req, db, deps.verify);
    if (who.status !== 200) {
      return { status: who.status, body: { error: who.status === 401 ? 'unauthorised' : 'not allowed' } };
    }

    if (path === '/api/salon' && method === 'GET') return getSalon(db);
    if (path === '/api/salon' && method === 'PUT') {
      return putSalon(db, req.body, {
        now,
        signedInAt: who.claims.auth_time ?? 0,
        confirmReset: (req.get?.('x-iris-reset') ?? '') === 'confirm',
      });
    }
    if (path === '/api/links' && method === 'POST') {
      const out = await createLink(db, req.body, { now });
      if (out.status === 200) out.body.url = `${originOf(req, env)}/b/${out.body.token}`;
      return out;
    }
    if ((m = path.match(/^\/api\/links\/([A-Za-z0-9_-]+)$/)) && method === 'DELETE') {
      return revokeLink(db, m[1]);
    }

    // Her cancelling a web booking from her diary. The same path the
    // Cloudflare version has always had, so the app speaks one language.
    if ((m = path.match(/^\/api\/bookings\/([A-Za-z0-9_-]+)\/cancel$/))) {
      if (method === 'GET') return previewSalonCancel(db, m[1], now);
      if (method === 'POST') {
        return cancelBySalon(db, m[1], {
          refund: req.body?.refund, cancelledAt: req.body?.cancelledAt, now,
        });
      }
    }

    if (path === '/api/days-off' && method === 'PUT') return putDaysOff(db, req.body?.ranges, { now });

    if (path === '/api/attention' && method === 'GET') return listAttention(db);
    if ((m = path.match(/^\/api\/attention\/([^/]+)\/dismiss$/)) && method === 'POST') {
      return dismissAttention(db, decodeURIComponent(m[1]), now);
    }
  }

  return { status: 404, body: { error: 'not found' } };
}

/**
 * The addresses this service is genuinely reached at.
 *
 * The project's own two Firebase Hosting domains, plus anything listed in
 * PUBLIC_HOSTS (a custom domain, comma-separated) — set as a function
 * environment variable if one is ever added.
 */
export function publicHosts(env = {}) {
  let project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || '';
  if (!project && env.FIREBASE_CONFIG) {
    try { project = JSON.parse(env.FIREBASE_CONFIG).projectId ?? ''; } catch { /* not JSON: ignore */ }
  }
  const listed = String(env.PUBLIC_HOSTS ?? '').split(/[\s,]+/).filter(Boolean);
  return [...listed, ...(project ? [`${project}.web.app`, `${project}.firebaseapp.com`] : [])];
}

/**
 * Where to send someone back to after Stripe, and the address a new link uses.
 *
 * Taken from the request, so the same code works on the web.app address, a
 * custom domain and the emulator — but only ever an address on the list. The
 * function can be called directly with any Host header, and believing it let
 * anyone get a genuine Stripe checkout for her salon that sent the payer, with
 * their booking's cancel token, to a site of the caller's choosing.
 */
export function originOf(req, env = {}) {
  const host = req.get?.('x-forwarded-host') || req.get?.('host') || '';
  // Local addresses only under the emulator, and only as the WHOLE host name:
  // a prefix test let `localhost.evil.com` through, which is the very redirect
  // this function exists to stop.
  if (env.FUNCTIONS_EMULATOR === 'true' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    return `http://${host}`;
  }
  const allowed = publicHosts(env);
  if (allowed.includes(host)) return `https://${host}`;
  // Not one of ours: her primary address instead — a custom domain if one is
  // listed, otherwise the project's web.app. With no project known at all
  // (only ever a test), there is nothing better to say than the host.
  return allowed.length ? `https://${allowed[0]}` : `https://${host}`;
}

/**
 * What a Stripe object currently says, in the classifier's shape.
 *
 * Always RE-FETCHED, never read from the event: events are snapshots and
 * arrive out of order, and a refund can overtake the payment it refunds.
 * Refunds and disputes arrive as charge-, refund- or dispute-shaped events and
 * are all read back through their PaymentIntent, which carries the booking id.
 */
export async function currentObject(stripe, event) {
  const obj = event?.data?.object ?? {};
  switch (obj.object) {
    case 'checkout.session':
      return fromCheckoutSession(await stripe.retrieveCheckoutSession(obj.id));
    case 'payment_intent':
      return fromPaymentIntent(await stripe.retrievePaymentIntent(obj.id));
    case 'charge':
    case 'refund':
    case 'dispute':
      return obj.payment_intent
        ? fromPaymentIntent(await stripe.retrievePaymentIntent(obj.payment_intent))
        : null;
    default:
      return null;
  }
}

/**
 * The webhook: the door, then the one confirm path.
 *
 * 400 for anything that fails the signature — Stripe does not retry those, and
 * nothing unsigned gets further. 500 when Stripe or the database cannot be
 * reached, so Stripe DOES retry. 200 for everything handled, including a
 * duplicate: answering a lost race with an error makes Stripe retry into the
 * same race.
 */
async function webhook(req, { db, env, stripe, FieldValue, now = Date.now() }) {
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody ?? '');
  const door = readEvent(raw, req.get?.('stripe-signature'), webhookSecrets(env), {
    now: Math.floor(now / 1000),
  });
  if (!door.ok) return { status: 400, body: { error: door.reason } };

  // Signed but unanswerable: without a key the object cannot be re-read, and
  // guessing from the payload is exactly what the re-fetch rule forbids.
  if (!stripe) return { status: 503, body: { error: 'stripe not configured' } };

  const result = await handleEvent(db, {
    event: { id: door.event.id, type: door.event.type },
    fetchObject: (event) => currentObject(stripe, { ...event, data: door.event.data }),
    now,
    FieldValue,
  });
  return { status: 200, body: { received: true, action: result.action } };
}

/**
 * The return from Stripe, asking the server to look.
 *
 * Not trusting the redirect — asking Stripe. The same confirm path the webhook
 * uses, so a booking no longer depends on webhook delivery alone: if the
 * webhook secret is wrong, or Stripe's delivery is delayed, the client coming
 * back is itself enough to confirm them, from Stripe's own record.
 *
 * The event id is derived from what Stripe reported, so looking twice at the
 * same state is a duplicate and a changed state is news.
 */
export async function checkPayment(db, cancelToken, { stripe, FieldValue, now = Date.now() }, { expire = false } = {}) {
  if (!stripe) return null;
  const found = await db.collection('bookings').where('cancelToken', '==', cancelToken).limit(1).get();
  const booking = found.docs[0]?.data();
  if (!booking || booking.status !== 'pending_payment' || !booking.stripe?.sessionId) return null;
  const sessionId = booking.stripe.sessionId;

  // Abandoning: first make the session impossible to pay into, THEN ask what
  // happened. The other order leaves a window to pay after the hour is
  // released. Stripe refuses to expire a session that has completed — which is
  // exactly the case where they paid in another tab, and the read below
  // confirms them instead.
  if (expire) await stripe.expireCheckoutSession(sessionId).catch(() => {});

  const session = await stripe.retrieveCheckoutSession(sessionId);
  const object = fromCheckoutSession(session);
  return handleEvent(db, {
    event: {
      id: `check:${sessionId}:${session?.status ?? 'unknown'}:${object.paymentStatus}:${object.amountRefundedMinor}`,
      // An expired session goes down the same path as Stripe's own expiry
      // event, which closes the booking and frees its hold.
      type: session?.status === 'expired' ? 'checkout.session.expired' : 'checkout.session.checked',
    },
    fetchObject: async () => object,
    now,
    FieldValue,
  });
}
