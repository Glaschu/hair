import nacl from 'tweetnacl';
import { syncScrypt } from 'scrypt-js';
import { toBase64, fromBase64 } from './sealedBox';

/**
 * Getting her salon key back after losing a phone.
 *
 * `bookingStore` keeps the secret key with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`
 * — deliberately, because a secret that syncs is a secret in a file. The cost of
 * that choice is real: drop the phone in the Clyde with the iPad un-paired at
 * home, and every sealed envelope in the cloud is unreadable for good.
 *
 * So there is a second copy, wrapped under a code that exists only on paper.
 * The wrapped blob is safe to store anywhere — it is useless without the code,
 * and the code was never uploaded.
 *
 * This has to land BEFORE the first deposit. Once money is attached to a
 * booking, an envelope nobody can open stops being an inconvenience and becomes
 * a dispute that cannot be answered.
 */

/**
 * Crockford base32: no I, L, O or U.
 *
 * Chosen because this gets handwritten on a card and read back months later by
 * someone who is not thinking about character sets. I/1 and O/0 are the pairs
 * people actually confuse, and U is dropped so the alphabet cannot spell
 * anything unfortunate.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 160 bits — 32 characters, in eight groups of five. */
const CODE_BYTES = 20;

/**
 * Deliberately slow. A recovery runs perhaps twice in a lifetime, so one to two
 * seconds on her oldest device is free, and it is the difference between a
 * stolen blob being brute-forced and not.
 */
export const KDF = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

function bytesToCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Accepts what someone actually writes down.
 *
 * Lower case, spaces, hyphens, and the substitutions a human makes without
 * noticing: a letter O for a zero, an I or L for a one. Rejecting those would
 * mean telling her the card is wrong when it is right.
 */
export function normalizeCode(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[ILÌ]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

export function isWellFormedCode(raw: string): boolean {
  const code = normalizeCode(raw);
  return code.length === 32 && [...code].every((c) => ALPHABET.includes(c));
}

/** `K7M2P-4XQ9R-…` — grouped, because a 32-character run is unreadable. */
export function formatCode(code: string): string {
  return (normalizeCode(code).match(/.{1,5}/g) ?? []).join('-');
}

export function newRecoveryCode(): string {
  return formatCode(bytesToCode(nacl.randomBytes(CODE_BYTES)));
}

export interface WrappedKey {
  v: 1;
  wrapped: string;
  salt: string;
  nonce: string;
  kdf: { N: number; r: number; p: number };
}

function derive(code: string, salt: Uint8Array): Uint8Array {
  const material = new TextEncoder().encode(normalizeCode(code));
  return new Uint8Array(syncScrypt(material, salt, KDF.N, KDF.r, KDF.p, KDF.dkLen));
}

/**
 * Wraps the salon secret key so only the code can open it.
 *
 * Only the result is ever uploaded. The code stays on paper, which is the whole
 * point: a backup that lives in the same place as the thing it backs up is not
 * a backup.
 */
export function wrapKey(secretKeyB64: string, code: string): WrappedKey {
  if (!isWellFormedCode(code)) throw new Error('recovery code is not the right shape');
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const sealed = nacl.secretbox(fromBase64(secretKeyB64), nonce, derive(code, salt));
  return {
    v: 1,
    wrapped: toBase64(sealed),
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    kdf: { N: KDF.N, r: KDF.r, p: KDF.p },
  };
}

/**
 * Returns the secret key, or null for a wrong code.
 *
 * Null rather than throwing, and with no detail about *how* it was wrong: a
 * message distinguishing "bad code" from "bad blob" is a small oracle, and
 * there is nothing useful she could do with the difference anyway.
 */
export function unwrapKey(blob: WrappedKey, code: string): string | null {
  if (!isWellFormedCode(code)) return null;
  try {
    const salt = fromBase64(blob.salt);
    const material = new TextEncoder().encode(normalizeCode(code));
    const key = new Uint8Array(
      syncScrypt(material, salt, blob.kdf.N, blob.kdf.r, blob.kdf.p, KDF.dkLen),
    );
    const opened = nacl.secretbox.open(fromBase64(blob.wrapped), fromBase64(blob.nonce), key);
    return opened ? toBase64(opened) : null;
  } catch {
    return null;
  }
}

/**
 * Whether deposits may be switched on.
 *
 * The design says key recovery lands before the first deposit; this is what
 * makes that a condition rather than a note. Two paired devices counts too — two
 * phones is the everyday redundancy, and the card is for when both are gone.
 */
export function canTakeDeposits(state: { recoveryVerifiedAt?: number | null; pairedDevices?: number }): boolean {
  return !!state.recoveryVerifiedAt || (state.pairedDevices ?? 0) >= 2;
}
