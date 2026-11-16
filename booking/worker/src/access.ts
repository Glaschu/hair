/**
 * Cloudflare Access in front of the setup page.
 *
 * The setup page hands out the device key, so whoever loads it can take
 * bookings as her. Rather than making her hold a secret and type it in,
 * Access checks she is who she says she is — an emailed code, no password
 * to keep — and stamps a signed token on the request. This verifies that
 * token ourselves.
 *
 * Verifying it here rather than trusting the header matters: a Worker is
 * reachable at more than one hostname, and an Access policy attached to
 * her custom domain does nothing for a request that arrives some other
 * way. A forged `Cf-Access-Jwt-Assertion` header costs nothing to send.
 */

export type AccessResult =
  | { ok: true; email: string }
  /** Nobody has put Access in front of this yet — fail closed, loudly. */
  | { ok: false; reason: 'unconfigured' }
  /** Configured, but this request did not come through the front door. */
  | { ok: false; reason: 'denied' };

/** Small clock skew, so a token issued a second ago is not "from the future". */
const SKEW_SECONDS = 60;
const CERTS_TTL_MS = 3_600_000;

/** One slot, keyed by URL: a Worker isolate serves one salon. */
let certCache: { url: string; at: number; keys: Map<string, CryptoKey> } | null = null;

/** Tests re-sign with fresh keys; nothing in production should call this. */
export function forgetCerts(): void {
  certCache = null;
}

function fromBase64Url(part: string): Uint8Array {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function cookie(request: Request, name: string): string {
  const jar = request.headers.get('cookie') ?? '';
  for (const part of jar.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

async function signingKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (certCache && certCache.url === url && Date.now() - certCache.at < CERTS_TTL_MS) {
    return certCache.keys;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const { keys } = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };

  const map = new Map<string, CryptoKey>();
  for (const jwk of keys ?? []) {
    if (!jwk.kid) continue;
    map.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    ));
  }
  certCache = { url, at: Date.now(), keys: map };
  return map;
}

/**
 * @param teamDomain  e.g. `yoursalon.cloudflareaccess.com`
 * @param aud         the Access application's AUD tag
 */
export async function verifyAccess(
  request: Request,
  teamDomain: string | undefined,
  aud: string | undefined,
): Promise<AccessResult> {
  if (!teamDomain || !aud) return { ok: false, reason: 'unconfigured' };

  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  if (!token) return { ok: false, reason: 'denied' };

  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return { ok: false, reason: 'denied' };

  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(head))) as { kid?: string; alg?: string };
    // Only RS256. Accepting `alg` from the token is how "alg: none" happens.
    if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'denied' };

    const key = (await signingKeys(teamDomain)).get(header.kid);
    if (!key) return { ok: false, reason: 'denied' };

    const signed = new TextEncoder().encode(`${head}.${body}`);
    const good = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, fromBase64Url(sig) as BufferSource, signed as BufferSource,
    );
    if (!good) return { ok: false, reason: 'denied' };

    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as {
      aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string;
    };

    // A valid signature from her team is not enough: every Access app in
    // the account is signed by the same keys, so the AUD tag is what says
    // "this token was minted for the setup page".
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud ?? ''];
    if (!audiences.includes(aud)) return { ok: false, reason: 'denied' };
    if (claims.iss !== `https://${teamDomain}`) return { ok: false, reason: 'denied' };

    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp + SKEW_SECONDS < now) return { ok: false, reason: 'denied' };
    if (claims.nbf && claims.nbf - SKEW_SECONDS > now) return { ok: false, reason: 'denied' };

    return { ok: true, email: claims.email ?? 'signed in' };
  } catch {
    return { ok: false, reason: 'denied' };
  }
}
