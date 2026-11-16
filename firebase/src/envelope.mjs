/**
 * Checks that what a booking page sent could be one of its sealed envelopes —
 * the shape only, since only her devices can open it.
 *
 * Without this, any string was stored as a booking. Her phone cannot open junk,
 * and an envelope it cannot open is deliberately never acknowledged (it might
 * be a real booking sealed to a key she can still recover), so a single bad
 * request sat in her inbox for good — the hour taken, and a warning on every
 * pull. The page always sends standard base64 of at least the box's own
 * overhead, so anything else is refused before it can take a slot.
 */

/** Ephemeral public key, nonce, and the authenticator: what even an empty message carries. */
const OVERHEAD_BYTES = 32 + 24 + 16;
const MAX_LENGTH = 4096;

export function isPlausibleEnvelope(sealed) {
  if (typeof sealed !== 'string' || sealed.length > MAX_LENGTH || sealed.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sealed)) return false;
  const padding = sealed.endsWith('==') ? 2 : sealed.endsWith('=') ? 1 : 0;
  return (sealed.length / 4) * 3 - padding > OVERHEAD_BYTES;
}

/** A retry key from the page: short, and a string — never something to query on blindly. */
export function isPlausibleRequestId(requestId) {
  return requestId == null || (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 100);
}
