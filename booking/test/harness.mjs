import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { makeD1 } from './d1.mjs';
import worker from '../worker/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const SITE_DIR = join(here, '../site');
export const DEVICE_KEY = 'test-device-key-not-a-real-one';
export const TEAM = 'test-team.cloudflareaccess.com';
export const AUD = 'aud-tag-for-the-setup-app';

/** The page's own seal(), lifted out of the shipped file. */
export function pageSeal() {
  const src = readFileSync(join(SITE_DIR, 'book.js'), 'utf8');
  const body = src.slice(src.indexOf('function seal('), src.indexOf('async function load()'));
  return new Function('nacl', `${body}; return seal;`)(nacl);
}

/**
 * A stand-in for Cloudflare Access: a real RSA keypair, a real JWKS served
 * over a stubbed fetch, and real RS256 tokens. The Worker verifies these
 * exactly as it verifies Cloudflare's, so a change that loosens the check
 * fails here rather than in front of her key.
 */
export async function makeAccess() {
  const rsa = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const pair = await crypto.subtle.generateKey(
    { ...rsa, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true, ['sign', 'verify'],
  );
  const stranger = await crypto.subtle.generateKey(
    { ...rsa, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true, ['sign', 'verify'],
  );

  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwks = { keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] };

  const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
  const part = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

  /** @param over  claim overrides, e.g. { exp }, or { signWith: 'stranger' } */
  async function token(over = {}) {
    const { signWith, kid = 'test-kid', alg = 'RS256', ...claims } = over;
    const now = Math.floor(Date.now() / 1000);
    const head = part({ alg, kid, typ: 'JWT' });
    const body = part({
      aud: [AUD], iss: `https://${TEAM}`, email: 'her@salon.test',
      iat: now, exp: now + 3600, ...claims,
    });
    const sig = await crypto.subtle.sign(
      rsa, signWith === 'stranger' ? stranger.privateKey : pair.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
  }

  // Only the certs URL is served; anything else reaching the network from a
  // Worker under test is a bug worth failing on.
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url;
    if (href === `https://${TEAM}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  };

  return { token, restore: () => { globalThis.fetch = real; } };
}

/**
 * A Worker wired to real SQLite, plus helpers to drive it.
 *
 * `access` defaults off: most tests are about her devices, not the setup
 * page, and an unconfigured service must refuse /setup rather than open it.
 */
export function makeService({ access = false, deviceKey = DEVICE_KEY } = {}) {
  const env = {
    DB: makeD1(join(here, '../worker/schema.sql')),
    DEVICE_KEY: deviceKey,
    ...(access ? { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } : {}),
    ASSETS: { fetch: async () => new Response('<!doctype html>page', { headers: { 'content-type': 'text/html' } }) },
  };

  const call = (path, init = {}) =>
    worker.fetch(new Request(`https://book.test${path}`, init), env);

  const authed = (path, init = {}) =>
    call(path, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_KEY}`, ...(init.headers ?? {}) },
    });

  /** A request arriving the way one does through Access. */
  const asHer = (path, jwt, init = {}) =>
    call(path, { ...init, headers: { 'cf-access-jwt-assertion': jwt, ...(init.headers ?? {}) } });

  return { env, call, authed, asHer };
}

export function newSalonKeys() {
  const kp = nacl.box.keyPair();
  const b64 = (b) => Buffer.from(b).toString('base64');
  return { publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
}
