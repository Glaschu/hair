import nacl from 'tweetnacl';
import {
  newRecoveryCode, normalizeCode, isWellFormedCode, formatCode,
  wrapKey, unwrapKey, canTakeDeposits, KDF,
} from '../recovery';
import { generateKeyPair, seal, unseal } from '../sealedBox';

/**
 * The card is what stands between a lost phone and a client history nobody can
 * read again. These tests are mostly about the human holding it: what they
 * write down, what they mistype, and what happens when they get it wrong.
 *
 * scrypt is deliberately slow, so the cases that actually derive a key are kept
 * few and the rest exercise the parts that do not.
 */

describe('the code as something a person writes on a card', () => {
  it('is 160 bits, grouped so it can be read aloud', () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){5}-[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(normalizeCode(code)).toHaveLength(32);
  });

  it('never contains the characters people confuse', () => {
    // I, L, O and U are absent by construction: I/1 and O/0 are the pairs that
    // get misread off a handwritten card.
    for (let i = 0; i < 50; i++) {
      expect(normalizeCode(newRecoveryCode())).not.toMatch(/[ILOU]/);
    }
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newRecoveryCode()));
    expect(seen.size).toBe(200);
  });

  it('accepts what someone actually types back', () => {
    const code = newRecoveryCode();
    const canonical = normalizeCode(code);
    for (const variant of [
      code.toLowerCase(),
      code.replace(/-/g, ''),
      code.replace(/-/g, ' '),
      `  ${code}  `,
    ]) {
      expect(normalizeCode(variant)).toBe(canonical);
    }
  });

  it('forgives the substitutions a human makes without noticing', () => {
    // Someone reading a handwritten card types O for zero and I or L for one.
    // Rejecting that means telling her the card is wrong when it is right.
    expect(normalizeCode('O1IL0')).toBe('01110');
    expect(normalizeCode('o-i-l')).toBe('011');
  });

  it('rejects a code of the wrong length or alphabet', () => {
    expect(isWellFormedCode('TOO-SHORT')).toBe(false);
    expect(isWellFormedCode('')).toBe(false);
    expect(isWellFormedCode('!'.repeat(32))).toBe(false);
    expect(isWellFormedCode(newRecoveryCode())).toBe(true);
  });

  it('formats back into groups from any input shape', () => {
    const code = newRecoveryCode();
    expect(formatCode(normalizeCode(code))).toBe(code);
    expect(formatCode(code.toLowerCase())).toBe(code);
  });
});

describe('wrapping and getting the key back', () => {
  // One keypair and one code for the whole block: scrypt at N=2^15 is slow on
  // purpose, and that is the point of it.
  const keys = generateKeyPair();
  const code = newRecoveryCode();
  let blob: ReturnType<typeof wrapKey>;

  beforeAll(() => { blob = wrapKey(keys.secretKey, code); });

  it('round-trips the secret key', () => {
    expect(unwrapKey(blob, code)).toBe(keys.secretKey);
  });

  it('opens with the code however she types it', () => {
    expect(unwrapKey(blob, normalizeCode(code))).toBe(keys.secretKey);
    expect(unwrapKey(blob, code.toLowerCase())).toBe(keys.secretKey);
  });

  it('returns null for the wrong code, without saying why', () => {
    // No distinction between "bad code" and "bad blob": that difference is a
    // small oracle and there is nothing she could do with it.
    expect(unwrapKey(blob, newRecoveryCode())).toBeNull();
  });

  it('returns null rather than throwing on a damaged blob', () => {
    expect(unwrapKey({ ...blob, wrapped: 'not base64 at all!!' }, code)).toBeNull();
    expect(unwrapKey({ ...blob, salt: '' }, code)).toBeNull();
  });

  it('stores nothing that reveals the key or the code', () => {
    const asText = JSON.stringify(blob);
    expect(asText).not.toContain(keys.secretKey);
    expect(asText).not.toContain(normalizeCode(code));
    // Safe to upload: without the card this is noise.
    expect(blob.kdf.N).toBe(KDF.N);
  });

  it('wraps to different bytes each time, so two cards cannot be compared', () => {
    const again = wrapKey(keys.secretKey, code);
    expect(again.wrapped).not.toBe(blob.wrapped);
    expect(again.salt).not.toBe(blob.salt);
    expect(unwrapKey(again, code)).toBe(keys.secretKey);
  });

  it('refuses to wrap under a code that is not a real code', () => {
    expect(() => wrapKey(keys.secretKey, 'hunter2')).toThrow();
  });

  it('recovers a key that can still open envelopes sealed before the phone was lost', () => {
    // The whole point, end to end: a client booked, the phone went, and the card
    // is what makes that booking readable again.
    const sealed = seal(JSON.stringify({ name: 'Sara', phone: '07700900000' }), keys.publicKey);
    const recovered = unwrapKey(blob, code)!;
    expect(JSON.parse(unseal(sealed, recovered)!)).toEqual({ name: 'Sara', phone: '07700900000' });
  });
});

describe('the shipping gate', () => {
  it('will not take deposits with no way back into the data', () => {
    expect(canTakeDeposits({})).toBe(false);
    expect(canTakeDeposits({ pairedDevices: 1 })).toBe(false);
    expect(canTakeDeposits({ recoveryVerifiedAt: null, pairedDevices: 0 })).toBe(false);
  });

  it('accepts a verified card, or two devices', () => {
    expect(canTakeDeposits({ recoveryVerifiedAt: Date.now() })).toBe(true);
    expect(canTakeDeposits({ pairedDevices: 2 })).toBe(true);
  });

  it('counts a verified card even on a single device', () => {
    // Two phones is the everyday redundancy; the card is for when both are gone.
    expect(canTakeDeposits({ recoveryVerifiedAt: Date.now(), pairedDevices: 1 })).toBe(true);
  });
});
