import {
  backendFor, LocalBackend, ServiceBackend, capabilitiesFor, whyUnavailable, notConnected, degraded,
  type Capability, type BackendMode,
} from '../backend';
import { newCredentials, decodeScannedCode } from '../bookingLink';

/**
 * Three ways to run the same app. The tests that matter here are not about what
 * each mode can do — that is a list — but about the promise underneath it: the
 * app asks what it can do, never which mode it is in, and a missing feature is
 * always explained rather than hidden.
 */

const creds = () => newCredentials('https://book.herstudio.co.uk', 'the-device-key');

const ALL: Capability[] = [
  'booking-links', 'deposits', 'refunds', 'server-messaging',
  'push', 'live-sync', 'reconciliation', 'offsite-backup',
];

describe('which backend a device is running', () => {
  it('is decided by credentials, not by a setting that can drift', () => {
    // No way to be in "hosted mode" with nothing to talk to.
    expect(backendFor(null).mode).toBe('in-app');
    expect(backendFor(creds()).mode).toBe('self-hosted');
    expect(backendFor(creds(), { mode: 'hosted' }).mode).toBe('hosted');
  });

  it('gives her today exactly what she has today', () => {
    const local = backendFor(null);
    expect(local).toBeInstanceOf(LocalBackend);
    for (const c of ALL) expect(local.has(c)).toBe(false);
  });

  it('is always healthy with no server, because there is nothing to be down', () => {
    // The app works on a train. That is the point of this mode.
    return expect(backendFor(null).health()).resolves.toEqual({ ok: true });
  });
});

describe('capabilities, not modes', () => {
  it('hosted and self-hosted offer the same things', () => {
    // They differ in who holds the keys and who carries the liability, not in
    // what she can do. If these ever diverge it must be a decision, and this
    // test is what forces it to be one.
    expect([...capabilitiesFor('hosted')].sort()).toEqual([...capabilitiesFor('self-hosted')].sort());
  });

  it('every capability is either offered or explained', () => {
    // The failure this prevents: a feature quietly missing with nothing said,
    // which reads to her as the app being broken.
    for (const mode of ['in-app', 'self-hosted', 'hosted'] as BackendMode[]) {
      const backend = mode === 'in-app' ? backendFor(null) : backendFor(creds(), { mode });
      for (const c of ALL) {
        if (!backend.has(c)) {
          expect(whyUnavailable(c).why.length).toBeGreaterThan(20);
        }
      }
    }
  });

  it('explains things in terms of her setup, not our architecture', () => {
    for (const c of ALL) {
      const { why } = whyUnavailable(c);
      expect(why).not.toMatch(/capability|backend|adapter|mode|implementation/i);
    }
  });

  it('offers something to do wherever there is something to do', () => {
    for (const c of ['booking-links', 'deposits', 'push'] as Capability[]) {
      expect(whyUnavailable(c).action?.route).toBe('BookingSetup');
    }
  });

  it('says what still works when something goes down', () => {
    // More important for trust than the absent case: she needs to know the app
    // has not eaten her day.
    expect(degraded('booking-links')).toMatch(/still works/i);
    expect(degraded('live-sync')).toMatch(/nothing is lost/i);
  });

  it('an unknown capability is refused rather than assumed available', () => {
    expect(backendFor(null).has('teleportation' as Capability)).toBe(false);
    expect(backendFor(creds()).has('teleportation' as Capability)).toBe(false);
  });
});

describe('reachability is not the same as capability', () => {
  it('reports the version when the service answers', async () => {
    const backend = new ServiceBackend(creds(), 'self-hosted', async () => ({ apiVersion: 1 }));
    await expect(backend.health()).resolves.toEqual({ ok: true, apiVersion: 1 });
  });

  it('a service that is down still HAS its capabilities', async () => {
    // Down is temporary; unsupported is not. Collapsing the two would make the
    // app offer to set up a booking service she already has.
    const backend = new ServiceBackend(creds(), 'self-hosted', async () => { throw new Error('offline'); });
    const health = await backend.health();
    expect(health.ok).toBe(false);
    expect(health.message).toBe('offline');
    expect(backend.has('deposits')).toBe(true);
  });
});

describe('the pairing code carries the mode', () => {
  const setupCode = (over: Record<string, unknown> = {}) => JSON.stringify({
    v: 2, kind: 'setup', url: 'https://book.herstudio.co.uk', dk: 'k', ...over,
  });

  it('reads a hosted code as hosted', () => {
    const scanned = decodeScannedCode(setupCode({ mode: 'hosted' }));
    expect(scanned).toMatchObject({ kind: 'setup', mode: 'hosted' });
  });

  it('still reads the v1 codes every deployed setup page produces', () => {
    // A stylist standing in front of a page we shipped months ago must not be
    // told her code is invalid because we added a field.
    const scanned = decodeScannedCode(JSON.stringify({
      v: 1, kind: 'setup', url: 'https://book.herstudio.co.uk', dk: 'k',
    }));
    expect(scanned).toMatchObject({ kind: 'setup', mode: 'self-hosted' });
  });

  it('treats an unknown mode as self-hosted rather than failing', () => {
    // Failing closed here would mean a valid code refusing to scan. Defaulting
    // to self-hosted is the safe reading: it claims nothing about an operator.
    expect(decodeScannedCode(setupCode({ mode: 'franchise' }))).toMatchObject({ mode: 'self-hosted' });
  });

  it('refuses a version it does not know', () => {
    expect(decodeScannedCode(setupCode({ v: 99 }))).toBeNull();
  });

  it('still refuses an insecure address in either version', () => {
    // The key is never sent over an unencrypted link, whatever the mode says.
    expect(decodeScannedCode(setupCode({ url: 'http://not-secure.example.com' }))).toBeNull();
    expect(decodeScannedCode(setupCode({ v: 1, url: 'http://not-secure.example.com' }))).toBeNull();
  });

  it('builds a backend straight from a scanned code', () => {
    const scanned = decodeScannedCode(setupCode({ mode: 'hosted' }));
    expect(scanned?.kind).toBe('setup');
    if (scanned?.kind !== 'setup') throw new Error('unreachable');

    const backend = backendFor(
      newCredentials(scanned.serviceUrl, scanned.deviceKey),
      { mode: scanned.mode === 'hosted' ? 'hosted' : 'self-hosted' },
    );
    expect(backend.mode).toBe('hosted');
    expect(backend.has('deposits')).toBe(true);
  });
});

describe('her own Stripe account, connected to her own service', () => {
  const probing = (capabilities: string[]) =>
    new ServiceBackend(creds(), 'self-hosted', async () => ({ apiVersion: 1, capabilities }));

  it('offers deposits once the service says Stripe is connected', async () => {
    const backend = probing(['booking-links', 'offsite-backup', 'deposits', 'refunds']);
    await backend.health();
    expect(backend.has('deposits')).toBe(true);
    expect(backend.has('refunds')).toBe(true);
  });

  it('does not offer a button that would fail', async () => {
    // Two services running identical code differ by which secrets their owner
    // set. A booking service with no Stripe key is a perfectly good booking
    // service that cannot take deposits.
    const backend = probing(['booking-links', 'offsite-backup']);
    await backend.health();
    expect(backend.has('booking-links')).toBe(true);
    expect(backend.has('deposits')).toBe(false);
  });

  it('says "connect Stripe", not "set up a booking service she already has"', async () => {
    const backend = probing(['booking-links', 'offsite-backup']);
    await backend.health();
    const { why, action } = backend.why('deposits');
    expect(why).toMatch(/stripe/i);
    expect(why).toMatch(/running/i);
    expect(action?.label).toMatch(/connect/i);
  });

  it('tells her the money is hers, because that is the thing worth knowing', async () => {
    const backend = probing(['booking-links']);
    await backend.health();
    expect(backend.why('deposits').why).toMatch(/your own stripe|nobody else/i);
  });

  it('is useful before the service has answered', async () => {
    // First paint on a cold start, or on a train. Going on the mode alone beats
    // showing her a crippled app until the network returns.
    const backend = probing([]);
    expect(backend.has('deposits')).toBe(true);
  });

  it('keeps what it last heard when the service goes quiet', async () => {
    // Down is not the same as unsupported. Forgetting would make the app offer
    // to set up a service she is already running.
    const flaky = new ServiceBackend(creds(), 'self-hosted', async () => {
      throw new Error('offline');
    });
    await flaky.health();
    expect(flaky.has('deposits')).toBe(true);
  });

  it('ignores a capability the mode does not allow, whatever the service claims', async () => {
    // A service cannot grant itself something the app does not understand.
    const backend = probing(['deposits', 'teleportation']);
    await backend.health();
    expect(backend.has('teleportation' as Capability)).toBe(false);
    expect(backend.has('deposits')).toBe(true);
  });

  it('has a fallback reason for anything not spelled out', () => {
    expect(notConnected('push').why.length).toBeGreaterThan(20);
  });
});
