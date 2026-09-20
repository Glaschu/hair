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
        return json({ service: 'iris-booking', api: API_VERSION });
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
        });
      }

      if (path === '/api/setup/reset' && method === 'POST') {
        const gate = await throughAccess(request, env);
        if (gate instanceof Response) return gate;

        // Starting over rotates the key as well as forgetting the salon.
        // Otherwise someone who photographed the old code still holds a
        // working key and can race her to register theirs.
        const fresh = newToken(24);
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO service (id, device_key, rotated_at) VALUES ('me', ?, ?)
             ON CONFLICT(id) DO UPDATE SET device_key = excluded.device_key,
                                           rotated_at = excluded.rotated_at`,
          ).bind(fresh, Date.now()),
          env.DB.prepare(`DELETE FROM salon WHERE id = 'me'`),
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

        await env.DB.prepare(
          `INSERT INTO salon (id, name, public_key, policy, updated_at) VALUES ('me', ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                         public_key = excluded.public_key,
                                         policy = excluded.policy,
                                         updated_at = excluded.updated_at`,
        ).bind(name, publicKey, policy ?? null, Date.now()).run();
        return json({ ok: true });
      }

      if (path === '/api/links' && method === 'POST') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const body = (await request.json()) as {
          clientRef?: string; greeting?: string; serviceName?: string;
          durationMins?: number; price?: number;
          slots?: { startsAt: string; endsAt: string }[];
        };
        if (!body.clientRef || !body.serviceName || !body.slots?.length) {
          return json({ error: 'clientRef, serviceName and at least one slot required' }, 400);
        }

        const token = newToken();
        const now = Date.now();
        const expires = now + LINK_TTL_DAYS * 86_400_000;

        const statements = [
          env.DB.prepare(
            `INSERT INTO links (token, client_ref, greeting, service_name, duration_mins, price, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            token, body.clientRef, body.greeting ?? null, body.serviceName,
            body.durationMins ?? 60, body.price ?? 0, now, expires,
          ),
          ...body.slots.map((s) =>
            env.DB.prepare(
              `INSERT INTO slots (id, token, starts_at, ends_at) VALUES (?, ?, ?, ?)`,
            ).bind(newToken(8), token, s.startsAt, s.endsAt),
          ),
        ];
        await env.DB.batch(statements);

        return json({ token, url: `${url.origin}/b/${token}`, expiresAt: expires });
      }

      if (path === '/api/bookings' && method === 'GET') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        const { results } = await env.DB.prepare(
          `SELECT b.id, b.token, b.client_ref AS clientRef, b.sealed, b.created_at AS createdAt,
                  b.agreed_at AS agreedAt,
                  l.service_name AS serviceName, l.duration_mins AS durationMins, l.price,
                  s.starts_at AS startsAt, s.ends_at AS endsAt
             FROM bookings b
             JOIN links l ON l.token = b.token
             JOIN slots s ON s.id = b.slot_id
            WHERE b.seen_at IS NULL
            ORDER BY b.created_at`,
        ).all();
        return json({ bookings: results });
      }

      const seen = path.match(/^\/api\/bookings\/([a-f0-9]+)\/seen$/);
      if (seen && method === 'POST') {
        if (!(await authed(request, env))) return json({ error: 'unauthorised' }, 401);
        await env.DB.prepare(`UPDATE bookings SET seen_at = ? WHERE id = ?`)
          .bind(Date.now(), seen[1]).run();
        return json({ ok: true });
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
                  l.price, l.expires_at AS expiresAt, l.revoked, s.name AS salonName, s.public_key AS publicKey,
                  s.policy
             FROM links l, salon s
            WHERE l.token = ? AND s.id = 'me'`,
        ).bind(view[1]).first();

        if (!link || link.revoked || (link.expiresAt as number) < Date.now()) {
          return json({ error: 'expired' }, 404);
        }

        const { results: slots } = await env.DB.prepare(
          `SELECT id, starts_at AS startsAt, ends_at AS endsAt
             FROM slots WHERE token = ? AND taken = 0 ORDER BY starts_at`,
        ).bind(view[1]).all();

        return json({
          salonName: link.salonName, greeting: link.greeting,
          serviceName: link.serviceName, durationMins: link.durationMins, price: link.price,
          publicKey: link.publicKey, policy: link.policy, slots,
        });
      }

      const book = path.match(/^\/api\/l\/([a-f0-9]+)\/book$/);
      if (book && method === 'POST') {
        const token = book[1];
        const { slotId, sealed, agreed } = (await request.json()) as
          { slotId?: string; sealed?: string; agreed?: boolean };
        if (!slotId || !sealed) return json({ error: 'slotId and sealed required' }, 400);
        // An envelope is ~120 bytes of overhead plus the details; anything
        // much larger is someone using the store as free disk space.
        if (sealed.length > 4096) return json({ error: 'too large' }, 413);

        const link = await env.DB.prepare(
          `SELECT token, client_ref AS clientRef, expires_at AS expiresAt, revoked FROM links WHERE token = ?`,
        ).bind(token).first();
        if (!link || link.revoked || (link.expiresAt as number) < Date.now()) {
          return json({ error: 'expired' }, 404);
        }

        // Claiming the slot is the lock: whoever flips taken first wins,
        // so two people tapping the same time can't both get it.
        const claim = await env.DB.prepare(
          `UPDATE slots SET taken = 1 WHERE id = ? AND token = ? AND taken = 0`,
        ).bind(slotId, token).run();
        if (!claim.meta.changes) return json({ error: 'taken' }, 409);

        const id = newToken(8);
        const now = Date.now();
        // Recorded separately from the envelope: if a late cancellation is ever
        // disputed, she needs to be able to see they agreed without opening a
        // booking on her phone.
        await env.DB.prepare(
          `INSERT INTO bookings (id, token, slot_id, client_ref, sealed, created_at, agreed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, token, slotId, link.clientRef, sealed, now, agreed ? now : null).run();

        return json({ ok: true, bookingId: id });
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
