import nacl from 'tweetnacl';

/**
 * The sealed envelope a booking travels in.
 *
 * The booking page holds only her PUBLIC key, so a browser can lock a
 * client's details but nothing — including the server that stores them —
 * can open them again. Only her devices hold the secret half.
 *
 * Layout: ephemeral public key (32) ‖ nonce (24) ‖ ciphertext.
 * That's NaCl's sealed box with the nonce carried explicitly, so both
 * sides can be plain TweetNaCl: React Native has no WebCrypto, so the
 * app and the page must run the same pure-JS implementation.
 */

const KEY_BYTES = nacl.box.publicKeyLength;   // 32
const NONCE_BYTES = nacl.box.nonceLength;     // 24

export interface KeyPairB64 {
  publicKey: string;
  secretKey: string;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
}

export function fromBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Her salon keypair. The secret half never leaves the keychain. */
/**
 * Hands tweetnacl its random source, explicitly.
 *
 * tweetnacl looks for one exactly once, as it loads, under `self.crypto`. On a
 * phone that only exists after react-native-get-random-values has run, so an
 * import landing in the wrong order left it with none — and every key it made
 * threw "no PRNG". Setting it here, at the moment of use, means import order can
 * never again silently break setting up online booking.
 */
let randomWired = false;
function ensureRandom(): void {
  if (randomWired) return;
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!source?.getRandomValues) {
    throw new Error('This device has no secure random source, so it cannot make keys.');
  }
  const fill = source.getRandomValues.bind(source);
  nacl.setPRNG((x: Uint8Array, n: number) => {
    const bytes = fill(new Uint8Array(n));
    for (let i = 0; i < n; i++) x[i] = bytes[i];
  });
  randomWired = true;
}

export function generateKeyPair(): KeyPairB64 {
  ensureRandom();
  const kp = nacl.box.keyPair();
  return { publicKey: toBase64(kp.publicKey), secretKey: toBase64(kp.secretKey) };
}

/** Locks a booking for her eyes only. Runs in the client's browser. */
export function seal(plaintext: string, recipientPublicKeyB64: string): string {
  ensureRandom();
  const recipient = fromBase64(recipientPublicKeyB64);
  if (recipient.length !== KEY_BYTES) throw new Error('Bad recipient key');

  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(NONCE_BYTES);
  const message = new TextEncoder().encode(plaintext);
  const box = nacl.box(message, nonce, recipient, ephemeral.secretKey);

  const out = new Uint8Array(KEY_BYTES + NONCE_BYTES + box.length);
  out.set(ephemeral.publicKey, 0);
  out.set(nonce, KEY_BYTES);
  out.set(box, KEY_BYTES + NONCE_BYTES);
  return toBase64(out);
}

/**
 * Opens a sealed booking on her device. Returns null when the envelope
 * is malformed or wasn't sealed for this key — a booking that can't be
 * opened is a problem to show her, never a crash.
 */
export function unseal(sealedB64: string, secretKeyB64: string): string | null {
  try {
    const raw = fromBase64(sealedB64);
    if (raw.length <= KEY_BYTES + NONCE_BYTES) return null;

    const ephemeralPublic = raw.slice(0, KEY_BYTES);
    const nonce = raw.slice(KEY_BYTES, KEY_BYTES + NONCE_BYTES);
    const box = raw.slice(KEY_BYTES + NONCE_BYTES);

    const opened = nacl.box.open(box, nonce, ephemeralPublic, fromBase64(secretKeyB64));
    return opened ? new TextDecoder().decode(opened) : null;
  } catch {
    return null;
  }
}

export interface SealedBooking {
  name: string;
  phone: string;
  email?: string;
  note?: string;
}

/** What the page seals, and what her device gets back out. */
export function sealBooking(booking: SealedBooking, publicKeyB64: string): string {
  return seal(JSON.stringify(booking), publicKeyB64);
}

export function unsealBooking(sealedB64: string, secretKeyB64: string): SealedBooking | null {
  const json = unseal(sealedB64, secretKeyB64);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name,
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
    };
  } catch {
    return null;
  }
}
