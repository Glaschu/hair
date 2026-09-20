import fs from 'fs';
import path from 'path';
import {
  isUsableServiceUrl, newCredentials, encodePairing, decodePairing, describeService,
  decodeScannedCode,
} from '../bookingLink';

describe('booking service credentials', () => {
  it('only accepts an https address', () => {
    expect(isUsableServiceUrl('https://book.herstudio.co.uk')).toBe(true);
    expect(isUsableServiceUrl('  https://book.herstudio.co.uk/  ')).toBe(true);
    expect(isUsableServiceUrl('http://book.herstudio.co.uk')).toBe(false); // never send a key in clear
    expect(isUsableServiceUrl('book.herstudio.co.uk')).toBe(false);
    expect(isUsableServiceUrl('')).toBe(false);
  });

  it('gives each salon its own keypair', () => {
    const a = newCredentials('https://book.example.co.uk/', 'device-key');
    const b = newCredentials('https://book.example.co.uk/', 'device-key');
    expect(a.serviceUrl).toBe('https://book.example.co.uk');   // trailing slash trimmed
    expect(a.keyPair.secretKey).not.toBe(b.keyPair.secretKey);
  });

  it('carries a whole setup to her second device', () => {
    const creds = newCredentials('https://book.herstudio.co.uk', 'device-key');
    const scanned = decodePairing(encodePairing(creds));
    expect(scanned).toEqual(creds);
  });

  it('refuses anything that is not a pairing code', () => {
    expect(decodePairing('5012345678900')).toBeNull();          // a product barcode
    expect(decodePairing('https://instagram.com/iris')).toBeNull();
    expect(decodePairing('{"v":2,"url":"https://x.co","dk":"a","pk":"b","sk":"c"}')).toBeNull();
    expect(decodePairing('{"v":1,"url":"http://x.co","dk":"a","pk":"b","sk":"c"}')).toBeNull();
    expect(decodePairing('{"v":1,"url":"https://x.co"}')).toBeNull();
    expect(decodePairing('')).toBeNull();
  });

  it('describes a link by its host, never its keys', () => {
    const creds = newCredentials('https://book.herstudio.co.uk', 'super-secret');
    const shown = describeService(creds);
    expect(shown).toBe('book.herstudio.co.uk');
    expect(shown).not.toContain('super-secret');
  });
});

describe('scanning a code', () => {
  const setupCode = (over = {}) => JSON.stringify({
    v: 1, kind: 'setup', url: 'https://book.herstudio.co.uk', dk: 'device-key', ...over,
  });

  it('knows a setup code from the service', () => {
    const scanned = decodeScannedCode(setupCode());
    expect(scanned).toEqual({
      kind: 'setup',
      serviceUrl: 'https://book.herstudio.co.uk',
      deviceKey: 'device-key',
      mode: 'self-hosted',
    });
  });

  it('knows a pairing code from a linked device', () => {
    const creds = newCredentials('https://book.herstudio.co.uk', 'device-key');
    const scanned = decodeScannedCode(encodePairing(creds));
    expect(scanned).toEqual({ kind: 'pairing', credentials: creds });
  });

  it('tells the two apart, so a scan never needs explaining', () => {
    const creds = newCredentials('https://book.herstudio.co.uk', 'device-key');
    expect(decodeScannedCode(setupCode())?.kind).toBe('setup');
    expect(decodeScannedCode(encodePairing(creds))?.kind).toBe('pairing');
  });

  it('refuses anything else', () => {
    expect(decodeScannedCode('5012345678900')).toBeNull();            // product barcode
    expect(decodeScannedCode('https://instagram.com/iris')).toBeNull();
    expect(decodeScannedCode(setupCode({ url: 'http://insecure.co' }))).toBeNull();
    expect(decodeScannedCode(setupCode({ dk: '' }))).toBeNull();
    // v2 is ours now — the boundary is versions we have never heard of, which
    // most likely mean an app older than the page it is scanning.
    expect(decodeScannedCode(setupCode({ v: 99 }))).toBeNull();
    expect(decodeScannedCode('')).toBeNull();
  });

  it('carries no salon keys in a setup code — the device makes its own', () => {
    expect(setupCode()).not.toContain('sk');
    const scanned = decodeScannedCode(setupCode());
    expect(scanned && 'credentials' in scanned).toBe(false);
  });
});

/**
 * The setup page builds its QR payload in the browser; the app reads it
 * on a phone. Two implementations, one format — so the real page code is
 * run against the real decoder rather than trusting they still agree.
 */
describe('setup page ↔ app', () => {
  function payloadFromSetupPage(origin: string, key: string): string {
    const html = fs.readFileSync(
      path.join(__dirname, '../../../booking/site/setup.html'), 'utf8',
    );
    // The page now builds the payload inline, from what /api/setup/qr returned,
    // rather than from a form field. Scraped rather than duplicated so the two
    // implementations cannot silently drift apart — which is the whole reason
    // this test exists.
    const line = html.match(/await QRCode\.toCanvas\(el\('qr'\), (JSON\.stringify\(\{[\s\S]*?\}\)),/);
    expect(line).not.toBeNull();
    // eslint-disable-next-line no-new-func
    return new Function('data', `return ${line![1]};`)({ url: origin, deviceKey: key });
  }

  it('produces a code this app can read', () => {
    const payload = payloadFromSetupPage('https://book.herstudio.co.uk', 'the-device-key');
    expect(decodeScannedCode(payload)).toEqual({
      kind: 'setup',
      serviceUrl: 'https://book.herstudio.co.uk',
      deviceKey: 'the-device-key',
      mode: 'self-hosted',
    });
  });

  it('never puts salon keys in the setup code', () => {
    const payload = payloadFromSetupPage('https://book.herstudio.co.uk', 'the-device-key');
    const parsed = JSON.parse(payload);
    expect(parsed.sk).toBeUndefined();
    expect(parsed.pk).toBeUndefined();
  });
});
