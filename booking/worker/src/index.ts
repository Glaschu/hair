/**
 * Iris booking service — phase 1.
 *
 * Holds times and sealed envelopes. It cannot read a client's name,
 * number or note: those are locked in the browser with the salon's
 * public key and only opened inside the app. Keep it that way — if a
 * future change needs to read a booking here, that is a decision to
 * take deliberately, not a convenience to slip in.
 */

import { verifyAccess } from './access.ts';

export interface Env {
  DB: D1Database;
  /**
   * Legacy: the device key used to be a Worker secret you set by hand.
   * It still works, but a service set up through the Access-protected
   * setup page makes and keeps its own key instead — see deviceKey().
   */
  DEVICE_KEY?: string;
  /**
   * Cloudflare Access, in front of /setup. Both must be set or the setup
   * page refuses to open: it hands out the device key, and a page that
   * hands out a key to whoever asks is not a setup page.
   *   ACCESS_TEAM_DOMAIN — yoursalon.cloudflareaccess.com
   *   ACCESS_AUD         — the Access application's AUD tag
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /**
   * HER Stripe account, not ours.
   *
   * Every deployment holds its own key, so deposits land in the balance of the
   * person who did the hair. Nobody's money passes through anyone else, which
   * is also what keeps whoever runs the code out of being a payment business.
   * Set with: npx wrangler secret put STRIPE_SECRET_KEY
   */
  STRIPE_SECRET_KEY?: string;
  /**
   * Optional second secret, required only to re-key an existing salon.
   * Kept out of the app and out of every QR so a leaked device key cannot
   * quietly redirect future bookings to someone else.
   */
  RESET_KEY?: string;
  ASSETS: Fetcher;
}

/**
 * Bumped whenever the app/service contract changes shape.
 *
 * Self-hosted copies of this service drift: someone deploys once and
 * never touches it again, then updates the app. Reporting a version lets
 * the app say "this booking service needs updating" instead of failing in
 * a way that looks like the app is broken.
 */
const API_VERSION = 1;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-iris-api': String(API_VERSION),
    },
  });

const LINK_TTL_DAYS = 21;

/**
 * What this particular deployment can do, from what it has been given.
 *
 * Reported rather than assumed: two services running identical code differ by
 * which secrets their owner has set, and the app cannot know that from the URL.
 */
function serviceCapabilities(env: Env): string[] {
  const caps = ['booking-links', 'offsite-backup'];
  if (env.STRIPE_SECRET_KEY) caps.push('deposits', 'refunds');
  return caps;
}

/**
 * Her terms, as data rather than prose. SETTLED: the shipped default wording
 * stands, and the notice period is two days.
 *
 * The arithmetic behind these numbers, because it is not obvious. On a £90
 * service with a 50% deposit of £45, the "remaining appointment cost" is the
 * other £45:
 *
 *   48h or more   no charge                         → refund the whole £45
 *   24-48h        50% of the remaining £45 = £22.50 → refund £22.50, keep £22.50
 *   under 24h     the full £90                      → refund nothing
 *
 * So `refundPct` is a percentage OF THE DEPOSIT, and it lines up with the prose
 * in the first two tiers exactly.
 *
 * THE LIMIT WORTH KNOWING: in the last tier the prose says the full amount, and
 * the deposit is only half of it. The service can stop money going back; it
 * cannot reach out and take more. Anything beyond the deposit is between her
 * and the client, and the app should say so rather than implying it collected.
 */
const DEFAULT_TIERS: { minNoticeHours: number; refundPct: number }[] = [
  { minNoticeHours: 48, refundPct: 100 },
  { minNoticeHours: 24, refundPct: 50 },
  { minNoticeHours: 0,  refundPct: 0 },
];

/** Which tier a cancellation falls into, from server time only. */
function tierFor(noticeMs: number, tiers = DEFAULT_TIERS): number {
  const hours = noticeMs / 3_600_000;
  // Boundaries go the client's way: exactly 48 hours is the 48-hour tier.
  const hit = tiers.find((t) => hours >= t.minNoticeHours);
  return hit ? hit.refundPct : 0;
}

/**
 * Cancels a booking and puts its hour back on the market, atomically.
 *
 * The status is the authority, not the slot: freeing a slot is what creates the
 * window for a stale write to reinstate a dead appointment, so a second cancel
 * is a no-op rather than a second release.
 */
async function cancelBooking(
  env: Env,
  booking: { id: string; token: string; slotId: string; startsAt: string; status: string },
  by: 'client' | 'salon',
): Promise<{ noticeMs: number; refundPct: number; alreadyCancelled: boolean }> {
  const now = Date.now();
  const noticeMs = Math.max(0, Date.parse(booking.startsAt) - now);
  const refundPct = tierFor(noticeMs);

  if (booking.status !== 'confirmed') {
    const row = await env.DB.prepare(
      `SELECT notice_ms AS noticeMs, refund_pct AS refundPct FROM bookings WHERE id = ?`,
    ).bind(booking.id).first<{ noticeMs: number; refundPct: number }>();
    return { noticeMs: row?.noticeMs ?? 0, refundPct: row?.refundPct ?? 0, alreadyCancelled: true };
  }

  await env.DB.batch([
    env.DB.prepare(
      // A client's cancellation goes back into her inbox (seen_at cleared), so
      // her diary hears about it on the next pull. A cancellation she never
      // learns of is a no-show she waits for, in an hour she could have resold.
      `UPDATE bookings
          SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?,
              notice_ms = ?, refund_pct = ?,
              seen_at = CASE WHEN ? = 'client' THEN NULL ELSE seen_at END
        WHERE id = ? AND status = 'confirmed'`,
    ).bind(now, by, noticeMs, refundPct, by, booking.id),
    // The hour goes back on sale. Without this it was gone for good: `taken`
    // was one-way, so a booking made by mistake made the slot unsellable.
    env.DB.prepare(`UPDATE slots SET taken = 0 WHERE id = ?`).bind(booking.slotId),
    env.DB.prepare(
      `UPDATE links SET booked_count = booked_count - 1
        WHERE token = ? AND booked_count > 0`,
    ).bind(booking.token),
    // When SHE cancels and nothing else is booked on the link, the link is
    // withdrawn: she is taking the time back, not offering it to the same
    // client again — and a revoked link stops blocking its hours, so she can
    // offer them to someone else. A client cancelling keeps their link, so
    // they can pick another time.
    env.DB.prepare(
      `UPDATE links SET revoked = 1
        WHERE token = ? AND booked_count = 0 AND ? = 'salon'`,
    ).bind(booking.token, by),
  ]);

  return { noticeMs, refundPct, alreadyCancelled: false };
}

/**
 * Could this be one of the booking page's sealed boxes? Standard base64 of at
 * least the box's own overhead — ephemeral key, nonce and authenticator. Kept
 * in step with firebase/src/envelope.mjs.
 */
function isPlausibleEnvelope(sealed: unknown): boolean {
  if (typeof sealed !== 'string' || sealed.length > 4096 || sealed.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sealed)) return false;
  const padding = sealed.endsWith('==') ? 2 : sealed.endsWith('=') ? 1 : 0;
  return (sealed.length / 4) * 3 - padding > 32 + 24 + 16;
}

/**
 * A slot that does not touch any of her days off. Used wherever a slot could be
 * shown or claimed, so a blocked day is refused everywhere at once — and
 * unblocking it puts those hours straight back, because nothing was deleted.
 */
const notOnADayOff = (slots: string) =>
  `NOT EXISTS (SELECT 1 FROM days_off d WHERE ${slots}.starts_at < d.ends_at AND ${slots}.ends_at > d.starts_at)`;

/** Compares without leaking which character differed. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authed(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  if (env.DEVICE_KEY && safeEqual(token, env.DEVICE_KEY)) return true;
  const row = await env.DB
    .prepare(`SELECT device_key AS k FROM service WHERE id = 'me'`)
    .first<{ k: string }>();
  return !!row?.k && safeEqual(token, row.k);
}

/**
 * The key her devices carry, minted on first use and kept here.
 *
 * Only the setup page reaches this, so an unauthenticated request can
 * never bring a key into being — before someone signs in to /setup there
 * is nothing to steal.
 */
async function deviceKey(env: Env): Promise<string> {
  const read = () => env.DB
    .prepare(`SELECT device_key AS k FROM service WHERE id = 'me'`)
    .first<{ k: string }>();

  const existing = await read();
  if (existing?.k) return existing.k;

  const fresh = newToken(24);
  await env.DB.prepare(
    `INSERT INTO service (id, device_key, rotated_at) VALUES ('me', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(fresh, Date.now()).run();
  // Two tabs opening at once: whoever lost the insert must use the winner's key.
  return (await read())?.k ?? fresh;
}

/**
 * Everything under /setup goes through here first. Unconfigured is 503,
 * not 403, because it is the self-hoster's own deployment telling them
 * they have not finished — a wrong answer they can act on.
 */
async function throughAccess(request: Request, env: Env): Promise<Response | { email: string }> {
  const seen = await verifyAccess(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (seen.ok) return { email: seen.email };
  if (seen.reason === 'unconfigured') {
    return json({
      error: 'not protected',
      detail: 'This page shows a key, so it stays shut until Cloudflare Access is in front of it. See README step 6.',
    }, 503);
  }
  return json({ error: 'forbidden' }, 403);
}

/** Content address for a policy, so the wording and its id can never drift. */
async function policyId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 128 bits, url-safe. Unguessable is the only thing protecting a link. */
function newToken(bytes = 16): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ---- anyone: what this service is and speaks ----

      if (path === '/api/version' && method === 'GET') {
        // What this deployment can actually do, as opposed to what the app
        // imagines a deployment can do. A stylist who has not connected Stripe
        // has a perfectly good booking service that cannot take deposits, and
        // the app should say that rather than offering her a broken button.
        return json({
          service: 'iris-booking',
          api: API_VERSION,
          capabilities: serviceCapabilities(env),
        });
      }

      // ---- the setup page (Cloudflare Access) ----
      //
      // She proves who she is to Cloudflare with an emailed code, and this
      // hands back the key. Nothing is typed, and nothing to lose or leak
      // between deploying the service and linking a phone.

      if (path === '/api/setup/qr' && method === 'GET') {
        const gate = await throughAccess(request, env);
        if (gate instanceof Response) return gate;

        const salon = await env.DB.prepare(
          `SELECT name, updated_at AS linkedAt FROM salon WHERE id = 'me'`,
        ).first<{ name: string; linkedAt: number }>();

        return json({
          url: url.origin,
          deviceKey: await deviceKey(env),
          salon: salon ?? null,
          signedInAs: gate.email,
          capabilities: serviceCapabilities(env),
          // Named plainly so the setup page can tell her what is missing and
          // exactly how to add it, rather than leaving her to infer it.
          stripe: { connected: !!env.STRIPE_SECRET_KEY },
        });
      }

      if (path === '/api/setup/reset' && method === 'POST') {
        const gate = await throughAccess(request, env);
        if (gate instanceof Response) return gate;

        // Starting over rotates the key as well as forgetting the salon.
        // Otherwise someone who photographed the old code still holds a
        // working key and can race her to register theirs.
        const fresh = newToken(24);
        const at = Date.now();
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO service (id, device_key, rotated_at) VALUES ('me', ?, ?)
             ON CONFLICT(id) DO UPDATE SET device_key = excluded.device_key,
                                           rotated_at = excluded.rotated_at`,
          ).bind(fresh, at),
          env.DB.prepare(`DELETE FROM salon WHERE id = 'me'`),
          // Outstanding links are sealed to the key we are throwing away. Leaving
          // them live meant anyone holding a token could keep booking for three
          // weeks into a salon that no longer exists.
          env.DB.prepare(`UPDATE links SET revoked = 1 WHERE revoked = 0`),
          // And retire what already arrived, so the newly-keyed device doesn't
          // download a pile of envelopes it can never open.
          env.DB.prepare(`UPDATE bookings SET seen_at = ? WHERE seen_at IS NULL`).bind(at),
        ]);

        console.log('booking service reset by', gate.email);
        return json({ ok: true, deviceKey: fresh });
      }

      // ---- her devices (bearer key) ----

      if (path === '/api/salon' && method === 'GET') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const salon = await env.DB.prepare(
          `SELECT name, public_key AS publicKey, policy FROM salon WHERE id = 'me'`,
        ).first();
        // 404 means "nobody has set this up yet", which is what a first
        // device needs to know before it registers a new keypair.
        return salon ? json(salon) : json({ error: 'not set up' }, 404);
      }

      if (path === '/api/salon' && method === 'PUT') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const { name, publicKey, policy } = (await request.json()) as
          { name?: string; publicKey?: string; policy?: string };
        if (!name || !publicKey) return json({ error: 'name and publicKey required' }, 400);
        // Her terms, not a client's words: capped so the page stays a page.
        if (policy && policy.length > 2000) return json({ error: 'policy too long' }, 413);

        // The salon key is write-once. Changing it redirects every future
        // booking to whoever set it, so a leaked device key must not be
        // enough on its own — re-keying needs a second secret that only
        // reaches this service through her Cloudflare account.
        const current = await env.DB.prepare(
          `SELECT public_key AS publicKey FROM salon WHERE id = 'me'`,
        ).first();

        if (current && current.publicKey !== publicKey) {
          const offered = request.headers.get('x-iris-reset') ?? '';
          const allowed = !!env.RESET_KEY && offered.length > 0 && safeEqual(offered, env.RESET_KEY);
          if (!allowed) {
            return json({
              error: 'already set up',
              detail: 'This service already has a salon. Re-keying needs the reset key.',
            }, 409);
          }
        }

        // Absent means "leave it", as on the Firebase version: a re-link or a
        // fresh start on a new phone sends no policy, and must not wipe terms
        // she has edited — the terms a chargeback turns on.
        await env.DB.prepare(
          `INSERT INTO salon (id, name, public_key, policy, updated_at) VALUES ('me', ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                         public_key = excluded.public_key,
                                         policy = CASE WHEN ? THEN excluded.policy ELSE salon.policy END,
                                         updated_at = excluded.updated_at`,
        ).bind(name, publicKey, policy ?? null, Date.now(), policy === undefined ? 0 : 1).run();
        return json({ ok: true });
      }

      if (path === '/api/days-off' && method === 'PUT') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const { ranges } = (await request.json()) as { ranges?: { from?: string; to?: string }[] };
        if (!Array.isArray(ranges) || ranges.length > 200) return json({ error: 'ranges required' }, 400);
        const spans = ranges.map((r) => ({ from: String(r?.from ?? ''), to: String(r?.to ?? '') }));
        if (spans.some((r) => !(Date.parse(r.from) < Date.parse(r.to)))) {
          return json({ error: 'each range needs from before to' }, 400);
        }
        // Stored as UTC ISO, so the slot comparisons in SQL are like for like.
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM days_off`),
          ...spans.map((r) => env.DB.prepare(`INSERT INTO days_off (starts_at, ends_at) VALUES (?, ?)`)
            .bind(new Date(r.from).toISOString(), new Date(r.to).toISOString())),
        ]);
        return json({ ok: true, count: spans.length });
      }

      if (path === '/api/links' && method === 'POST') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const body = (await request.json()) as {
          clientRef?: string; greeting?: string; serviceName?: string;
          durationMins?: number; priceMinor?: number; tz?: string; maxBookings?: number;
          slots?: { startsAt: string; endsAt: string }[];
        };
        if (!body.clientRef || !body.serviceName || !body.slots?.length) {
          return json({ error: 'clientRef, serviceName and at least one slot required' }, 400);
        }

        // Every slot must be a real interval, or the overlap check below is
        // comparing nonsense.
        for (const slot of body.slots) {
          const s0 = Date.parse(slot.startsAt), e0 = Date.parse(slot.endsAt);
          if (!Number.isFinite(s0) || !Number.isFinite(e0) || e0 <= s0) {
            return json({ error: 'each slot needs startsAt before endsAt' }, 400);
          }
        }

        // Two links must never offer the same hour. The app checks her calendar
        // when she makes a link, but it cannot see the other links she has out,
        // so without this two clients can both book the same Saturday.
        // A link that has taken all its bookings offers nothing any more:
        // counting its untaken hours kept them off sale for every other
        // client until it expired, three weeks after one of them was booked.
        const { results: live } = await env.DB.prepare(
          `SELECT s.starts_at AS startsAt, s.ends_at AS endsAt
             FROM slots s JOIN links l ON l.token = s.token
            WHERE l.revoked = 0 AND l.expires_at > ?
              AND (s.taken = 1 OR l.booked_count < l.max_bookings)`,
        ).bind(Date.now()).all<{ startsAt: string; endsAt: string }>();

        const clash = body.slots.find((slot) => {
          const s0 = Date.parse(slot.startsAt), e0 = Date.parse(slot.endsAt);
          return live.some((o: { startsAt: string; endsAt: string }) =>
            s0 < Date.parse(o.endsAt) && Date.parse(o.startsAt) < e0);
        });
        // Never offer an hour on one of her days off — the app already skips
        // them, but the service is where it has to be true.
        const { results: off } = await env.DB.prepare(
          `SELECT starts_at AS startsAt, ends_at AS endsAt FROM days_off`,
        ).all<{ startsAt: string; endsAt: string }>();
        const onDayOff = body.slots.find((slot) =>
          off.some((d: { startsAt: string; endsAt: string }) =>
            Date.parse(slot.startsAt) < Date.parse(d.endsAt) && Date.parse(d.startsAt) < Date.parse(slot.endsAt)));
        if (onDayOff) {
          return json({ error: 'day off', detail: 'That time is on one of your days off.', startsAt: onDayOff.startsAt }, 409);
        }

        if (clash) {
          return json({
            error: 'slot already offered',
            detail: 'Another link is already offering that time. Revoke it first, or pick another.',
            startsAt: clash.startsAt,
          }, 409);
        }

        const token = newToken();
        const now = Date.now();
        const expires = now + LINK_TTL_DAYS * 86_400_000;

        const salon = await env.DB.prepare(
          `SELECT policy FROM salon WHERE id = 'me'`,
        ).first<{ policy: string | null }>();
        const pid = salon?.policy ? await policyId(salon.policy) : null;
        const tiers = JSON.stringify(DEFAULT_TIERS);

        const statements = [
          ...(pid && salon?.policy
            ? [env.DB.prepare(
                // Words and numbers are stored together, so a link pins both.
                // A policy whose prose says 48 hours and whose tiers say 24 is
                // the kind of thing that only surfaces in an argument.
                `INSERT INTO policies (id, text, tiers, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO NOTHING`,
              ).bind(pid, salon.policy, tiers, now)]
            : []),
          env.DB.prepare(
            `INSERT INTO links (token, client_ref, greeting, service_name, duration_mins,
                                price_minor, tz, policy_id, created_at, expires_at, max_bookings)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            token, body.clientRef, body.greeting ?? null, body.serviceName,
            body.durationMins ?? 60, Math.round(body.priceMinor ?? 0),
            body.tz ?? 'Europe/London', pid, now, expires,
            Math.max(1, Math.round(body.maxBookings ?? 1)),
          ),
          ...body.slots.map((slot) =>
            env.DB.prepare(
              `INSERT INTO slots (id, token, starts_at, ends_at) VALUES (?, ?, ?, ?)`,
            )// Normalised to UTC ISO, so times compare correctly as text.
            .bind(newToken(8), token, new Date(slot.startsAt).toISOString(), new Date(slot.endsAt).toISOString()),
          ),
        ];
        await env.DB.batch(statements);

        return json({ token, url: `${url.origin}/b/${token}`, expiresAt: expires });
      }

      if (path === '/api/bookings' && method === 'GET') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        // `?all=1` exists because marking a booking seen and storing it locally
        // are two round-trips. Lose the device between them and a booking that
        // only the unseen filter could reach is gone for good -- silently, with
        // the row still sitting here. Nothing should ever be unreachable.
        const all = url.searchParams.get('all') === '1';
        const { results } = await env.DB.prepare(
          `SELECT b.id, b.token, b.client_ref AS clientRef, b.sealed, b.created_at AS createdAt,
                  b.agreed_at AS agreedAt, b.agreed_policy_id AS agreedPolicyId, b.seen_at AS seenAt,
                  b.status, b.cancelled_at AS cancelledAt, b.cancelled_by AS cancelledBy,
                  b.refund_pct AS refundPct,
                  l.service_name AS serviceName, l.duration_mins AS durationMins,
                  l.price_minor AS priceMinor, l.tz,
                  s.starts_at AS startsAt, s.ends_at AS endsAt
             FROM bookings b
             JOIN links l ON l.token = b.token
             JOIN slots s ON s.id = b.slot_id
            ${all ? '' : 'WHERE b.seen_at IS NULL'}
            ORDER BY b.created_at`,
        ).all();
        return json({ bookings: results });
      }

      const seen = path.match(/^\/api\/bookings\/([a-f0-9]+)\/seen$/);
      if (seen && method === 'POST') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        // Only if it is still in the state the device saw. A client cancelling
        // between the device's fetch and this call puts it back in the inbox;
        // acknowledging blindly swallowed that cancellation.
        const { status } = (await request.json().catch(() => ({}))) as { status?: string };
        await env.DB.prepare(
          `UPDATE bookings SET seen_at = ? WHERE id = ? AND (? IS NULL OR status = ?)`,
        ).bind(Date.now(), seen[1], status ?? null, status ?? null).run();
        return json({ ok: true });
      }

      // Her device cancelling, from the app.
      const scrub = path.match(/^\/api\/bookings\/([a-f0-9]+)\/cancel$/);
      if (scrub && method === 'POST') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const booking = await env.DB.prepare(
          `SELECT b.id, b.token, b.slot_id AS slotId, b.status, s.starts_at AS startsAt
             FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE b.id = ?`,
        ).bind(scrub[1]).first<{ id: string; token: string; slotId: string; status: string; startsAt: string }>();
        if (!booking) return json({ error: 'no such booking' }, 404);

        const out = await cancelBooking(env, booking, 'salon');
        return json({ ok: true, ...out });
      }

      // The client cancelling their own, with the token their booking returned.
      // No account, no login — the token is the whole credential, and it can do
      // nothing except cancel this one booking.
      const bail = path.match(/^\/api\/c\/([a-f0-9]+)$/);
      if (bail && (method === 'POST' || method === 'GET')) {
        const booking = await env.DB.prepare(
          `SELECT b.id, b.token, b.slot_id AS slotId, b.status, b.notice_ms AS noticeMs,
                  b.refund_pct AS refundPct, s.starts_at AS startsAt, l.service_name AS serviceName,
                  l.tz
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             JOIN links l ON l.token = b.token
            WHERE b.cancel_token = ?`,
        ).bind(bail[1]).first<{
          id: string; token: string; slotId: string; status: string;
          noticeMs: number; refundPct: number; startsAt: string; serviceName: string; tz: string;
        }>();
        if (!booking) return json({ error: 'no such booking' }, 404);

        // GET is a preview: what would happen if they cancelled now. Nobody
        // should discover the charge only after pressing the button.
        if (method === 'GET') {
          const noticeMs = Math.max(0, Date.parse(booking.startsAt) - Date.now());
          return json({
            status: booking.status, startsAt: booking.startsAt, tz: booking.tz,
            serviceName: booking.serviceName,
            noticeMs, refundPct: booking.status === 'confirmed' ? tierFor(noticeMs) : booking.refundPct,
          });
        }

        const out = await cancelBooking(env, booking, 'client');
        return json({ ok: true, startsAt: booking.startsAt, ...out });
      }

      const revoke = path.match(/^\/api\/links\/([a-f0-9]+)$/);
      if (revoke && method === 'DELETE') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        await env.DB.prepare(`UPDATE links SET revoked = 1 WHERE token = ?`).bind(revoke[1]).run();
        return json({ ok: true });
      }

      // ---- the client's link (public, but unguessable) ----

      const view = path.match(/^\/api\/l\/([a-f0-9]+)$/);
      if (view && method === 'GET') {
        const link = await env.DB.prepare(
          `SELECT l.token, l.greeting, l.service_name AS serviceName, l.duration_mins AS durationMins,
                  l.price_minor AS priceMinor, l.tz, l.expires_at AS expiresAt, l.revoked,
                  l.max_bookings AS maxBookings, l.booked_count AS bookedCount,
                  s.name AS salonName, s.public_key AS publicKey,
                  p.text AS policy, p.id AS policyId
             FROM links l
             JOIN salon s ON s.id = 'me'
             LEFT JOIN policies p ON p.id = l.policy_id
            WHERE l.token = ?`,
        ).bind(view[1]).first();

        if (!link || link.revoked || (link.expiresAt as number) < Date.now()
            || (link.bookedCount as number) >= (link.maxBookings as number)) {
          return json({ error: 'expired' }, 404);
        }

        const { results: slots } = await env.DB.prepare(
          `SELECT id, starts_at AS startsAt, ends_at AS endsAt
             FROM slots s WHERE token = ? AND taken = 0 AND starts_at > ? AND ${notOnADayOff('s')}
            ORDER BY starts_at`,
        ).bind(view[1], new Date().toISOString()).all();

        return json({
          salonName: link.salonName, greeting: link.greeting,
          serviceName: link.serviceName, durationMins: link.durationMins,
          priceMinor: link.priceMinor, tz: link.tz,
          publicKey: link.publicKey, policy: link.policy, policyId: link.policyId, slots,
        });
      }

      const book = path.match(/^\/api\/l\/([a-f0-9]+)\/book$/);
      if (book && method === 'POST') {
        const token = book[1];
        const { slotId, sealed, agreed, requestId } = (await request.json()) as
          { slotId?: string; sealed?: string; agreed?: boolean; requestId?: string };
        if (!slotId || !sealed) return json({ error: 'slotId and sealed required' }, 400);
        // An envelope is ~120 bytes of overhead plus the details; anything
        // much larger is someone using the store as free disk space.
        if (sealed.length > 4096) return json({ error: 'too large' }, 413);
        // The shape only — only her devices can open it. Junk used to be stored
        // as a booking: it took the hour, and because an envelope her phone
        // cannot open is never acknowledged, it sat in her inbox for good.
        if (!isPlausibleEnvelope(sealed)) return json({ error: 'not a sealed envelope' }, 400);

        // A retry after a lost response must return the original booking. Without
        // this the page says "someone took that time" and sends them to a second
        // slot -- one person, two bookings, and with a deposit, two charges.
        if (requestId) {
          const prior = await env.DB.prepare(
            `SELECT id, status, cancel_token AS cancelToken
               FROM bookings WHERE token = ? AND request_id = ?`,
          ).bind(token, requestId).first<{ id: string; status: string; cancelToken: string }>();
          // Only a live booking short-circuits. Replaying a cancelled one would
          // tell someone they are booked when they are not.
          if (prior && prior.status === 'confirmed') {
            return json({ ok: true, bookingId: prior.id, cancelToken: prior.cancelToken, replayed: true });
          }
        }

        // Joining salon matters: after a reset there is no salon, so there is no
        // key to seal to and nothing should be accepted.
        const link = await env.DB.prepare(
          `SELECT l.token, l.client_ref AS clientRef, l.expires_at AS expiresAt, l.revoked,
                  l.policy_id AS policyId, l.max_bookings AS maxBookings, l.booked_count AS bookedCount
             FROM links l JOIN salon s ON s.id = 'me'
            WHERE l.token = ?`,
        ).bind(token).first();
        if (!link || link.revoked || (link.expiresAt as number) < Date.now()) {
          return json({ error: 'expired' }, 404);
        }
        if ((link.bookedCount as number) >= (link.maxBookings as number)) {
          return json({ error: 'expired', detail: 'This link has already been used.' }, 404);
        }

        // The server decides what was agreed, from the policy pinned to the link
        // it served. A boolean from the browser proves nothing -- curl sends it
        // too -- and an agreement record that can be forged is worse than none.
        if (link.policyId && !agreed) {
          return json({
            error: 'policy not agreed',
            detail: 'The cancellation policy has to be accepted before booking.',
          }, 422);
        }

        const id = newToken(8);
        const cancelToken = newToken(16);
        const now = Date.now();

        // One batch: claiming the slot, counting it against the link and writing
        // the booking either all happen or none do. Two statements meant a dead
        // isolate between them burned the slot with no booking behind it.
        const written = await env.DB.batch([
          env.DB.prepare(
            `UPDATE slots SET taken = 1 WHERE id = ? AND token = ? AND taken = 0 AND starts_at > ? AND ${notOnADayOff('slots')}`,
          ).bind(slotId, token, new Date().toISOString()),
          env.DB.prepare(
            `UPDATE links SET booked_count = booked_count + 1
              WHERE token = ? AND booked_count < max_bookings`,
          ).bind(token),
          env.DB.prepare(
            `INSERT INTO bookings (id, token, slot_id, client_ref, sealed, created_at,
                                   agreed_at, agreed_policy_id, request_id, cancel_token)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id, token, slotId, link.clientRef, sealed, now,
            link.policyId ? now : null, link.policyId ?? null, requestId ?? null, cancelToken,
          ),
        ]);

        // Whoever flipped `taken` first wins. If we lost, the batch still wrote a
        // booking, so undo it rather than leaving a ghost.
        if (!written[0].meta.changes) {
          await env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(id).run();
          await env.DB.prepare(
            `UPDATE links SET booked_count = booked_count - 1 WHERE token = ? AND booked_count > 0`,
          ).bind(token).run();
          return json({ error: 'taken' }, 409);
        }

        return json({ ok: true, bookingId: id, cancelToken });
      }

      // ---- the pages ----
      if (/^\/b\/[a-f0-9]+$/.test(path)) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
      }
      if (path === '/setup' || path === '/setup/') {
        const gate = await throughAccess(request, env);
        if (gate instanceof Response && gate.status === 503) return gate;
        if (gate instanceof Response) {
          // Access normally intercepts this long before the Worker sees it.
          // Arriving here means the request came in some other way.
          return new Response('Not found', { status: 404 });
        }
        return env.ASSETS.fetch(new Request(new URL('/setup.html', url), request));
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      // Never echo the error back — it can carry query fragments.
      console.error('booking worker error', err instanceof Error ? err.message : err);
      return json({ error: 'server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
