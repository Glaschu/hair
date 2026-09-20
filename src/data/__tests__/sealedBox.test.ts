import {
  generateKeyPair, seal, unseal, sealBooking, unsealBooking, toBase64, fromBase64,
} from '../sealedBox';

describe('sealed envelope', () => {
  it('locks on the page and opens on her device', () => {
    const salon = generateKeyPair();
    // The page only ever holds the public half.
    const sealed = seal('Sara Whitfield · 07700 900118', salon.publicKey);
    expect(unseal(sealed, salon.secretKey)).toBe('Sara Whitfield · 07700 900118');
  });

  it('reveals nothing to whoever stores it', () => {
    const salon = generateKeyPair();
    const sealed = seal('Sara Whitfield · 07700 900118', salon.publicKey);
    expect(sealed).not.toContain('Sara');
    expect(sealed).not.toContain('07700');
    // A different salon's key cannot open it.
    expect(unseal(sealed, generateKeyPair().secretKey)).toBeNull();
  });

  it('gives a different envelope every time, so two bookings never match', () => {
    const salon = generateKeyPair();
    const a = seal('same details', salon.publicKey);
    const b = seal('same details', salon.publicKey);
    expect(a).not.toBe(b);
    expect(unseal(a, salon.secretKey)).toBe(unseal(b, salon.secretKey));
  });

  it('refuses tampered or truncated envelopes instead of crashing', () => {
    const salon = generateKeyPair();
    const sealed = seal('Sara Whitfield', salon.publicKey);

    const bytes = fromBase64(sealed);
    bytes[bytes.length - 1] ^= 0xff;            // flip a bit of ciphertext
    expect(unseal(toBase64(bytes), salon.secretKey)).toBeNull();

    expect(unseal(sealed.slice(0, 20), salon.secretKey)).toBeNull();
    expect(unseal('', salon.secretKey)).toBeNull();
    expect(unseal('not base64 at all!!', salon.secretKey)).toBeNull();
  });

  it('rejects a malformed recipient key rather than sealing to nothing', () => {
    expect(() => seal('hello', 'too-short')).toThrow();
  });

  it('carries a whole booking there and back', () => {
    const salon = generateKeyPair();
    const booking = {
      name: 'Sara Whitfield',
      phone: '07700 900118',
      email: 'sara@example.com',
      note: 'Growing out a box dye — never had a reaction.',
    };
    const sealed = sealBooking(booking, salon.publicKey);
    expect(unsealBooking(sealed, salon.secretKey)).toEqual(booking);
  });

  it('survives accents and emoji in a note', () => {
    const salon = generateKeyPair();
    const booking = { name: 'Zoë Ó Braonáin', phone: '+44 7700 900118', note: 'café 〜 ✂️' };
    const sealed = sealBooking(booking, salon.publicKey);
    expect(unsealBooking(sealed, salon.secretKey)).toEqual({ ...booking, email: undefined });
  });

  it('treats junk in an opened envelope as no booking', () => {
    const salon = generateKeyPair();
    expect(unsealBooking(seal('{"nope":1}', salon.publicKey), salon.secretKey)).toBeNull();
    expect(unsealBooking(seal('not json', salon.publicKey), salon.secretKey)).toBeNull();
  });
});
