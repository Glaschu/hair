import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifying that a webhook really came from Stripe.
 *
 * This is the door. Everything behind it moves money — confirming bookings,
 * issuing refunds — and the only thing between a stranger and all of it is a
 * signature check, because the endpoint is necessarily public.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 and sends it as
 * `Stripe-Signature: t=<unix>,v1=<hex>`. Several `v1` values can appear at once
 * during a secret rotation, which is the whole point of rotation: both secrets
 * are live for a window so nothing is dropped while you swap them over.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 *   THE RAW BODY. Verify the bytes as received. Parsing to JSON and
 *   re-stringifying changes key order and whitespace, and the signature will
 *   never match — which usually gets "fixed" by skipping verification.
 *
 *   NEVER A PLAIN ===. A string compare leaks timing. `timingSafeEqual` on
 *   equal-length buffers is the whole cost of not caring about that.
 */

/** Stripe's own default, and the reason a wrong clock reads as an outage. */
export const TOLERANCE_SECONDS = 300;

export function parseSignatureHeader(header) {
  const parts = String(header ?? '').split(',');
  const out = { t: null, v1: [] };
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k?.trim() === 't') out.t = Number(v);
    // More than one during a rotation; all of them are candidates.
    if (k?.trim() === 'v1' && v) out.v1.push(v.trim());
  }
  return out;
}

export function sign(rawBody, secret, timestamp) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function sameSecret(a, b) {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // sorts — but a length difference already tells you they differ, so compare
  // lengths first and only then in constant time.
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param secrets one or more signing secrets. More than one is how a rotation
 *   happens without dropping events: accept both until the old one is retired.
 * @returns {{ ok: true }} | {{ ok: false, reason: string }}
 */
export function verifySignature(rawBody, header, secrets, {
  now = Math.floor(Date.now() / 1000),
  tolerance = TOLERANCE_SECONDS,
} = {}) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (!list.length) return { ok: false, reason: 'no_secret_configured' };

  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !Number.isFinite(t)) return { ok: false, reason: 'no_timestamp' };
  if (!v1.length) return { ok: false, reason: 'no_signature' };

  // Recency, in both directions. A replay from last week is refused, and so is
  // something stamped in the future — which is a skewed clock somewhere, and
  // trusting it would widen the replay window rather than close it.
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: 'timestamp_outside_tolerance' };

  for (const secret of list) {
    const expected = sign(rawBody, secret, t);
    if (v1.some((candidate) => sameSecret(candidate, expected))) return { ok: true };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

/**
 * The whole door in one call: verify, then parse.
 *
 * Parsing happens only AFTER the signature checks out, so a malformed or
 * hostile body is never handed to a JSON parser on an unauthenticated request.
 */
export function readEvent(rawBody, header, secrets, opts = {}) {
  const check = verifySignature(rawBody, header, secrets, opts);
  if (!check.ok) return check;
  try {
    const event = JSON.parse(rawBody);
    if (!event?.id || !event?.type) return { ok: false, reason: 'not_an_event' };
    return { ok: true, event };
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
}
