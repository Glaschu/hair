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
    const all = [...html.matchAll(/currentCode = (JSON\.stringify\(\{[\s\S]*?\}\));/g)];
    const line = all.find((m) => m[1].includes('data.deviceKey'));
    expect(line).toBeDefined();
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

describe('the Firebase deployment', () => {
  const fb = { apiKey: 'AIza-test', authDomain: 'jessie-salon.firebaseapp.com', projectId: 'jessie-salon' };

  function firebaseCodeFromSetupPage(origin: string): string {
    const html = fs.readFileSync(path.join(__dirname, '../../../booking/site/setup.html'), 'utf8');
    // Scraped, like the Cloudflare code above, so the page and the app cannot
    // drift apart. This is the variant built from Hosting's init.json.
    const all = [...html.matchAll(/currentCode = (JSON\.stringify\(\{[\s\S]*?\}\));/g)];
    const firebaseOne = all.find((m) => m[1].includes('fb:'));
    expect(firebaseOne).toBeDefined();
    // eslint-disable-next-line no-new-func
    return new Function('location', 'fb', `return ${firebaseOne![1]};`)({ origin }, fb);
  }

  it("reads the setup page's code, which has no device key, and keeps the project", () => {
    // Before: the empty device key was rejected, and a code that did get
    // through had its Firebase config thrown away at the next step.
    const scanned = decodeScannedCode(firebaseCodeFromSetupPage('https://jessie-salon.web.app'));
    expect(scanned).toEqual({
      kind: 'setup', serviceUrl: 'https://jessie-salon.web.app', deviceKey: '',
      mode: 'self-hosted', firebase: fb,
    });
  });

  it('an empty device key is only valid WITH a Firebase project', () => {
    const noKey = JSON.stringify({ v: 2, kind: 'setup', url: 'https://book.example.com', dk: '' });
    expect(decodeScannedCode(noKey)).toBeNull();
  });

  it('carries the project into the credentials a setup code becomes', () => {
    expect(newCredentials('https://jessie-salon.web.app', '', fb).firebase).toEqual(fb);
    expect(newCredentials('https://book.example.com', 'dk').firebase).toBeUndefined();
  });

  it('a second device paired from the first gets the project too', () => {
    // Without it the second device has the keys but nothing to sign in to.
    const creds = { ...newCredentials('https://jessie-salon.web.app', '', fb) };
    const paired = decodePairing(encodePairing(creds));
    expect(paired?.firebase).toEqual(fb);
    expect(paired?.keyPair).toEqual(creds.keyPair);
  });

  it('still reads pairing codes made before the project was carried', () => {
    const old = JSON.stringify({ v: 1, url: 'https://book.example.com', dk: 'dk', pk: 'pk', sk: 'sk' });
    expect(decodePairing(old)).toMatchObject({ deviceKey: 'dk', keyPair: { publicKey: 'pk', secretKey: 'sk' } });
  });
});
