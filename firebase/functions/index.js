import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { route } from './src/routes.mjs';
import { stripeClient } from './src/stripeClient.mjs';
import { drainOutbox, tidyOutbox } from './src/drainOutbox.mjs';
import { refundSender } from './src/refunds.mjs';

/**
 * The Firebase deployment: wiring only. Every decision lives in `./src`, where
 * the tests drive it — including the whole deposit path end to end in
 * `money.test.mjs`.
 *
 * Hosting rewrites /api/** here, so the page and its API share an origin — the
 * same property the Cloudflare version has, and the reason neither needs CORS
 * opened up.
 *
 * `./src` is copied in from `../src` by the predeploy hook in firebase.json and
 * is gitignored. One home for the shared modules, so what deploys is what the
 * tests ran against.
 */

initializeApp();
const db = getFirestore();

/** London: her clients are in Glasgow, and latency to a booking page matters. */
const REGION = 'europe-west2';

/**
 * A v2 function can only read secrets it DECLARES — setting one is not enough.
 * Both must exist before a deploy succeeds. Deposits are offered only when
 * both hold real values: see `depositsEnabled`.
 */
const SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

export const api = onRequest(
  { region: REGION, cors: false, maxInstances: 10, secrets: SECRETS },
  async (req, res) => {
    // A booking link is one-use and short-lived. Caching any of this would show
    // someone a slot that has since gone.
    res.set('Cache-Control', 'no-store');
    try {
      const { status, body } = await route(req, {
        db,
        env: process.env,
        stripe: stripeClient(process.env),
        verify: (token) => getAuth().verifyIdToken(token),
        FieldValue,
      });
      res.status(status).json(body);
    } catch (err) {
      // Never echo the error back — it can carry query fragments and ids. A 500
      // on the webhook is deliberate: Stripe retries it.
      console.error('booking api', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'server error' });
    }
  },
);

/**
 * Refunds, on their own clock.
 *
 * Never in a request path: a cancellation must not fail because Stripe is slow,
 * and the refund must not be lost because the function froze after answering.
 * The row was written in the same transaction as the cancellation; this turns
 * it into money back on the card.
 */
export const refunds = onSchedule(
  { schedule: 'every 5 minutes', region: REGION, secrets: SECRETS, timeZone: 'Europe/London' },
  async () => {
    await tidyOutbox(db).catch((e) => console.error('outbox tidy', e?.message ?? e));
    const stripe = stripeClient(process.env);
    if (!stripe) return;
    const out = await drainOutbox(db, { kind: 'refund_deposit', send: refundSender(db, stripe) });
    // A dead or deferred refund is someone's money. Loud, so it shows in the
    // logs as an error rather than scrolling past.
    if (out.dead || out.deferred) console.error('refunds need attention', out);
  },
);
