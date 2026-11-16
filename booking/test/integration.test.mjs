import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeService, makeAccess, pageSeal, newSalonKeys, DEVICE_KEY } from './harness.mjs';
import { forgetCerts } from '../worker/src/access.ts';
import { unsealBooking } from '../../src/data/sealedBox.ts';

/**
 * The whole chain, for real: the Worker's own SQL against SQLite, the
 * booking page's own seal(), and the app's own unseal(). If any link in
 * that chain drifts, a booking silently becomes unreadable — so it is
 * tested end to end rather than piece by piece.
 */

const inDays = (n, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function setUpSalon() {
  const svc = makeService();
  const keys = newSalonKeys();

  const reg = await svc.authed('/api/salon', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }),
  });
  assert.equal(reg.status, 200);

  const made = await svc.authed('/api/links', {
    method: 'POST',
    body: JSON.stringify({
      clientRef: 'ref-abc123', greeting: 'Sara', serviceName: 'Consultation',
      durationMins: 30, priceMinor: 4500, maxBookings: 4,
      slots: [
        { startsAt: inDays(3, 11), endsAt: inDays(3, 12) },
        { startsAt: inDays(5, 10), endsAt: inDays(5, 11) },
      ],
    }),
  });
  assert.equal(made.status, 200);
  const link = await made.json();
  return { svc, keys, link };
}

describe('booking, end to end', () => {
  test('a client books and it arrives readable only on her device', async () => {
    const { svc, keys, link } = await setUpSalon();

    // What the client's browser sees.
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(page.salonName, 'Iris');
    assert.equal(page.greeting, 'Sara');
    assert.equal(page.slots.length, 2);
    assert.equal(page.publicKey, keys.publicKey);
    assert.ok(!('secretKey' in page), 'the secret half must never be served');

    // The page seals with its own code and books.
    const seal = pageSeal();
    const sealed = seal(JSON.stringify({
      name: 'Sara Whitfield', phone: '07700 900118', note: 'Growing out a box dye',
    }), page.publicKey);

    const booked = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    });
    assert.equal(booked.status, 200);

    // What the stored row actually contains.
    const stored = svc.env.DB._raw.prepare('SELECT sealed FROM bookings').get();
    assert.ok(!stored.sealed.includes('Sara'), 'a name must never be stored in the clear');
    assert.ok(!stored.sealed.includes('07700'), 'a number must never be stored in the clear');

    // What her app gets back.
    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.equal(bookings.length, 1);
    const details = unsealBooking(bookings[0].sealed, keys.secretKey);
    assert.deepEqual(details, {
      name: 'Sara Whitfield', phone: '07700 900118',
      email: undefined, note: 'Growing out a box dye',
    });
    assert.equal(bookings[0].clientRef, 'ref-abc123', 'so iris knows whose booking it is');
    assert.equal(bookings[0].serviceName, 'Consultation');
  });

  test('a taken time cannot be taken twice', async () => {
    const { svc, link } = await setUpSalon();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const seal = pageSeal();
    const body = (slotId) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId, sealed: seal('{"name":"A","phone":"1"}', page.publicKey) }),
    });

    const first = await svc.call(`/api/l/${link.token}/book`, body(page.slots[0].id));
    const second = await svc.call(`/api/l/${link.token}/book`, body(page.slots[0].id));
    assert.equal(first.status, 200);
    assert.equal(second.status, 409, 'the second person must be turned away');

    // And it disappears from the page rather than lingering as bait.
    const after = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(after.slots.length, 1);
  });

  test('her devices are the only ones that can look', async () => {
    const { svc } = await setUpSalon();

    assert.equal((await svc.call('/api/bookings')).status, 401);
    assert.equal((await svc.call('/api/links', { method: 'POST', body: '{}' })).status, 401);
    assert.equal(
      (await svc.call('/api/bookings', { headers: { authorization: 'Bearer wrong-key' } })).status,
      401,
    );
    assert.equal(
      (await svc.call('/api/bookings', { headers: { authorization: `Bearer ${DEVICE_KEY}` } })).status,
      200,
    );
  });

  test('a revoked link stops working immediately', async () => {
    const { svc, link } = await setUpSalon();
    assert.equal((await svc.call(`/api/l/${link.token}`)).status, 200);

    await svc.authed(`/api/links/${link.token}`, { method: 'DELETE' });

    assert.equal((await svc.call(`/api/l/${link.token}`)).status, 404);
    const blocked = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: 'anything', sealed: Buffer.alloc(120, 7).toString('base64') }),
    });
    assert.equal(blocked.status, 404);
  });

  test('a booking is only handed over once', async () => {
    const { svc, link } = await setUpSalon();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const seal = pageSeal();
    await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed: seal('{"name":"A","phone":"1"}', page.publicKey) }),
    });

    const { bookings } = await (await svc.authed('/api/bookings')).json();
    await svc.authed(`/api/bookings/${bookings[0].id}/seen`, { method: 'POST' });

    const { bookings: second } = await (await svc.authed('/api/bookings')).json();
    assert.equal(second.length, 0, 'an imported booking must not come back');
  });

  test('rubbish is refused rather than stored', async () => {
    const { svc, link } = await setUpSalon();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();

    const missing = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);

    const huge = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed: 'x'.repeat(5000) }),
    });
    assert.equal(huge.status, 413, 'the store is not free disk space');

    // Not an envelope at all. Her phone could never open it, and an envelope it
    // cannot open is never acknowledged — so this used to sit in her inbox for
    // good, with the hour taken.
    for (const sealed of ['x', 'not base64!', Buffer.alloc(10).toString('base64'), { an: 'object' }]) {
      const junk = await svc.call(`/api/l/${link.token}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: page.slots[0].id, sealed }),
      });
      assert.equal(junk.status, 400, `refused: ${JSON.stringify(sealed)}`);
    }

    assert.equal(svc.env.DB._raw.prepare('SELECT COUNT(*) n FROM bookings').get().n, 0);
  });
});

describe('self-hosting', () => {
  test('reports what THIS deployment can do, not what the software can do', async () => {
    // Two services running identical code differ by which secrets their owner
    // set. Without Stripe, this is a perfectly good booking service that cannot
    // take deposits — and the app needs to know that before offering a button.
    const bare = makeService();
    const plain = await (await bare.call('/api/version')).json();
    assert.ok(plain.capabilities.includes('booking-links'));
    assert.ok(!plain.capabilities.includes('deposits'), 'no Stripe key, no deposits');

    const withStripe = makeService();
    withStripe.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
    const paid = await (await withStripe.call('/api/version')).json();
    assert.ok(paid.capabilities.includes('deposits'));
    assert.ok(paid.capabilities.includes('refunds'));
  });

  test('says what it is, so the app can spot a stale deployment', async () => {
    const { svc } = await setUpSalon();
    const res = await svc.call('/api/version');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.service, 'iris-booking');
    assert.equal(body.api, 1);
    // Capabilities are asserted separately, in the test above — a deep-equal
    // here would break every time a deployment learns to do something new.
    assert.ok(Array.isArray(body.capabilities));
    assert.equal(res.headers.get('x-iris-api'), '1', 'every response carries it too');
  });

  test('a fresh service reports no salon, so a first device knows to make keys', async () => {
    const svc = makeService();            // deployed but never set up
    const res = await svc.authed('/api/salon');
    assert.equal(res.status, 404);
  });

  test('an already-set-up service names its salon, so a second device is warned', async () => {
    const { svc, keys } = await setUpSalon();
    const salon = await (await svc.authed('/api/salon')).json();
    assert.equal(salon.name, 'Iris');
    assert.equal(salon.publicKey, keys.publicKey);
  });

  test('the salon is not readable without the device key', async () => {
    const { svc } = await setUpSalon();
    assert.equal((await svc.call('/api/salon')).status, 401);
  });

  test('serves the setup page at /setup, once Access is in front of it', async () => {
    const access = await makeAccess();
    try {
      forgetCerts();
      const svc = makeService({ access: true, deviceKey: undefined });
      const res = await svc.asHer('/setup', await access.token());
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /html/);
    } finally {
      access.restore();
    }
  });
});

describe('a leaked device key', () => {
  test('cannot point future bookings at someone else', async () => {
    const { svc, keys } = await setUpSalon();
    const attacker = newSalonKeys();

    // The attacker has the device key — everything they could plausibly steal.
    const hijack = await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: attacker.publicKey }),
    });
    assert.equal(hijack.status, 409, 'the salon key must be write-once');

    // Her key is untouched, so bookings still seal to her.
    const page = await (await svc.call('/api/l/' + (await freshLink(svc)).token)).json();
    assert.equal(page.publicKey, keys.publicKey);
  });

  test('re-registering the same key is harmless', async () => {
    const { svc, keys } = await setUpSalon();
    const again = await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris Studio', publicKey: keys.publicKey }),
    });
    assert.equal(again.status, 200, 'a device re-registering must not be locked out');
  });

  test('re-registering without terms keeps the terms she set', async () => {
    const { svc, keys } = await setUpSalon();
    const terms = 'Cancel 72 hours ahead for a full refund.';
    await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: terms }),
    });
    // What setup on a new device sends: a name and a key, no policy.
    const relink = await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }),
    });
    assert.equal(relink.status, 200);
    assert.equal((await (await svc.authed('/api/salon')).json()).policy, terms);
  });

  test('she can still start over with the reset key from her own account', async () => {
    const { svc, keys } = await setUpSalon();
    svc.env.RESET_KEY = 'reset-secret-set-with-wrangler';
    const replacement = newSalonKeys();

    const refused = await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: replacement.publicKey }),
    });
    assert.equal(refused.status, 409, 'still refused without the reset key');

    const allowed = await svc.authed('/api/salon', {
      method: 'PUT',
      headers: { 'x-iris-reset': 'reset-secret-set-with-wrangler' },
      body: JSON.stringify({ name: 'Iris', publicKey: replacement.publicKey }),
    });
    assert.equal(allowed.status, 200);

    const now = await (await svc.authed('/api/salon')).json();
    assert.equal(now.publicKey, replacement.publicKey);
    assert.notEqual(now.publicKey, keys.publicKey);
  });

  test('a wrong reset key is refused', async () => {
    const { svc } = await setUpSalon();
    svc.env.RESET_KEY = 'the-real-reset-key';
    const res = await svc.authed('/api/salon', {
      method: 'PUT',
      headers: { 'x-iris-reset': 'guessing' },
      body: JSON.stringify({ name: 'Iris', publicKey: newSalonKeys().publicKey }),
    });
    assert.equal(res.status, 409);
  });
});

async function freshLink(svc) {
  const made = await svc.authed('/api/links', {
    method: 'POST',
    body: JSON.stringify({
      clientRef: 'ref-2', serviceName: 'Consultation', durationMins: 30, priceMinor: 4500, maxBookings: 4,
      slots: [{ startsAt: inDays(7, 11), endsAt: inDays(7, 12) }],
    }),
  });
  return made.json();
}

/**
 * The setup page hands out the key her devices carry, so the only thing
 * standing between a stranger and her bookings is this check. Each test is
 * one way in that has to stay shut.
 */
describe('the setup page', () => {
  let access;
  before(async () => { access = await makeAccess(); });
  after(() => access.restore());
  beforeEach(() => forgetCerts());

  const svc = () => makeService({ access: true, deviceKey: undefined });

  test('signs her in and shows a key without her ever typing one', async () => {
    const res = await svc().asHer('/api/setup/qr', await access.token());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.signedInAs, 'her@salon.test');
    assert.equal(body.salon, null, 'a fresh service has nobody linked');
    assert.match(body.deviceKey, /^[a-f0-9]{48}$/);
  });

  test('the key it shows is the one the app is then let in with', async () => {
    const s = svc();
    const { deviceKey } = await (await s.asHer('/api/setup/qr', await access.token())).json();

    const mine = await s.call('/api/salon', { headers: { authorization: `Bearer ${deviceKey}` } });
    assert.equal(mine.status, 404, 'let in, and told there is no salon yet');

    const theirs = await s.call('/api/salon', { headers: { authorization: 'Bearer guessed' } });
    assert.equal(theirs.status, 401);
  });

  test('hands back the same key on a second visit', async () => {
    const s = svc();
    const first = await (await s.asHer('/api/setup/qr', await access.token())).json();
    const again = await (await s.asHer('/api/setup/qr', await access.token())).json();
    assert.equal(first.deviceKey, again.deviceKey);
  });

  test('no token at all gets nothing', async () => {
    assert.equal((await svc().call('/api/setup/qr')).status, 403);
    assert.equal((await svc().call('/setup')).status, 404);
  });

  test('a token someone else signed is not a token', async () => {
    const res = await svc().asHer('/api/setup/qr', await access.token({ signWith: 'stranger' }));
    assert.equal(res.status, 403);
  });

  test('an expired sign-in is over', async () => {
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const res = await svc().asHer('/api/setup/qr', await access.token({ exp: hourAgo }));
    assert.equal(res.status, 403);
  });

  test("a token for someone else's Access app is refused", async () => {
    // Every app in a Cloudflare account is signed by the same keys, so the
    // AUD tag is the only thing saying this one was minted for the setup page.
    const res = await svc().asHer('/api/setup/qr', await access.token({ aud: ['some-other-app'] }));
    assert.equal(res.status, 403);
  });

  test('"alg: none" is not an algorithm', async () => {
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const forged = [
      b64u({ alg: 'none', kid: 'test-kid', typ: 'JWT' }),
      b64u({ aud: ['aud-tag-for-the-setup-app'], iss: 'https://test-team.cloudflareaccess.com', exp: now + 3600 }),
      '',
    ].join('.');
    assert.equal((await svc().asHer('/api/setup/qr', forged)).status, 403);
  });

  test('a service with no Access in front of it refuses to open at all', async () => {
    // Fail closed: deploying and forgetting step 4 must not leave the key
    // sitting behind a URL. 503 rather than 403 — it is their own deployment
    // telling them they have not finished.
    const bare = makeService({ access: false, deviceKey: undefined });
    const res = await bare.call('/api/setup/qr');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'not protected');
    assert.equal((await bare.call('/setup')).status, 503);
  });

  test('starting over unlinks the salon and retires the old key', async () => {
    const s = svc();
    const { deviceKey: old } = await (await s.asHer('/api/setup/qr', await access.token())).json();

    const keys = newSalonKeys();
    await s.call('/api/salon', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${old}` },
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }),
    });

    const shown = await (await s.asHer('/api/setup/qr', await access.token())).json();
    assert.equal(shown.salon.name, 'Iris', 'the page says what it is linked to');

    const reset = await s.asHer('/api/setup/reset', await access.token(), { method: 'POST' });
    assert.equal(reset.status, 200);
    const { deviceKey: fresh } = await reset.json();
    assert.notEqual(fresh, old);

    // Whoever photographed the old code is out, not just the old phone.
    const stale = await s.call('/api/salon', { headers: { authorization: `Bearer ${old}` } });
    assert.equal(stale.status, 401);

    // And the new phone registers cleanly rather than hitting "already set up".
    const fresher = newSalonKeys();
    const again = await s.call('/api/salon', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${fresh}` },
      body: JSON.stringify({ name: 'Iris', publicKey: fresher.publicKey }),
    });
    assert.equal(again.status, 200);
  });

  test('a stranger cannot start over', async () => {
    const s = svc();
    await s.asHer('/api/setup/qr', await access.token());
    assert.equal((await s.call('/api/setup/reset', { method: 'POST' })).status, 403);
  });

  test('an unauthenticated request never brings a key into being', async () => {
    // If merely knocking created one, a leak later would hand out a key that
    // had been sitting there the whole time.
    const s = svc();
    await s.call('/api/salon');
    await s.call('/api/setup/qr');
    const row = await s.env.DB.prepare(`SELECT device_key FROM service WHERE id = 'me'`).first();
    assert.equal(row, null);
  });
});

/**
 * Her cancellation terms: 48 hours notice, 50% inside that, the full amount
 * inside 24. A client agreeing to them is the thing she needs on record if a
 * late cancellation is ever argued about.
 */
describe('cancellation policy', () => {
  const POLICY = 'Please give at least 48 hours notice.\nLess than 48 hours is charged 50%.';

  async function withPolicy() {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: POLICY }),
    });
    const made = await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({
        clientRef: 'ref-1', serviceName: 'Colour', durationMins: 60, priceMinor: 9000,
        slots: [{ startsAt: inDays(3, 11), endsAt: inDays(3, 12) }],
      }),
    });
    return { svc, keys, link: await made.json() };
  }

  test('the client sees the terms before there is anything to agree to', async () => {
    const { svc, link } = await withPolicy();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(page.policy, POLICY);
  });

  test('agreeing is recorded beside the booking, not sealed inside it', async () => {
    const { svc, keys, link } = await withPolicy();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);

    const booked = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    });
    assert.equal(booked.status, 200);

    // She can see it agreed without unsealing anything.
    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.equal(bookings.length, 1);
    assert.ok(bookings[0].agreedAt > 0, 'agreement is timestamped');

    // And the envelope still only opens on her device.
    const details = unsealBooking(bookings[0].sealed, keys.secretKey);
    assert.equal(details.name, 'Sara');
  });

  test('a booking that did not agree is refused outright', async () => {
    // The old behaviour let it through and simply left agreedAt null, which gave
    // her a booking she could not defend. The tick is now a server-side condition.
    const { svc, link } = await withPolicy();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);

    const res = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed }),
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, 'policy not agreed');

    // And nothing was written -- the slot is still free.
    const again = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(again.slots.length, 1, 'the slot was not consumed by a refused booking');
  });

  test('a service with no policy set still works', async () => {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }),
    });
    const made = await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({
        clientRef: 'r', serviceName: 'Cut', slots: [{ startsAt: inDays(2, 10), endsAt: inDays(2, 11) }],
      }),
    });
    const link = await made.json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(page.policy, null);
  });

  test('a policy long enough to be an attachment is refused', async () => {
    const svc = makeService();
    const keys = newSalonKeys();
    const res = await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: 'x'.repeat(2001) }),
    });
    assert.equal(res.status, 413);
  });
});

/**
 * One test per defect found by red-teaming the design. Each names the loss it
 * prevents, because a regression here is a booking or a deposit, not a red dot.
 */
describe('losses that used to be possible', () => {
  const at = (days, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  async function salon(svc) {
    const keys = newSalonKeys();
    await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: 'Give 48 hours notice.' }),
    });
    return keys;
  }

  const mint = (svc, slots, extra = {}) => svc.authed('/api/links', {
    method: 'POST',
    body: JSON.stringify({ clientRef: 'ref-1', serviceName: 'Colour', priceMinor: 9000, slots, ...extra }),
  });

  test('two links cannot offer the same hour', async () => {
    const svc = makeService();
    await salon(svc);
    const first = await mint(svc, [{ startsAt: at(3, 11), endsAt: at(3, 13) }]);
    assert.equal(first.status, 200);

    // Overlapping, not identical — the bug was that only exact slot rows collided.
    const second = await mint(svc, [{ startsAt: at(3, 12), endsAt: at(3, 14) }]);
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, 'slot already offered');

    // Butting up against it is fine; that is a real back-to-back appointment.
    const third = await mint(svc, [{ startsAt: at(3, 13), endsAt: at(3, 14) }]);
    assert.equal(third.status, 200);
  });

  test("a used-up link's other hours go back on offer — the booked one does not", async () => {
    // Offered twice, booked once: the other hour used to stay blocked from
    // every other client until the link expired, three weeks later.
    const svc = makeService();
    const keys = await salon(svc);
    const made = await (await mint(svc, [
      { startsAt: at(6, 10), endsAt: at(6, 11) },
      { startsAt: at(7, 10), endsAt: at(7, 11) },
    ])).json();
    const page = await (await svc.call(`/api/l/${made.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), keys.publicKey);
    const booked = await svc.call(`/api/l/${made.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    });
    assert.equal(booked.status, 200);

    assert.equal((await mint(svc, [{ startsAt: at(7, 10), endsAt: at(7, 11) }])).status, 200,
      'the hour nobody took is free to offer again');
    assert.equal((await mint(svc, [{ startsAt: at(6, 10), endsAt: at(6, 11) }])).status, 409,
      'the hour that was booked is not');
  });

  test('a revoked link frees its hour for the next one', async () => {
    const svc = makeService();
    await salon(svc);
    const made = await (await mint(svc, [{ startsAt: at(4, 10), endsAt: at(4, 11) }])).json();
    await svc.authed(`/api/links/${made.token}`, { method: 'DELETE' });
    const again = await mint(svc, [{ startsAt: at(4, 10), endsAt: at(4, 11) }]);
    assert.equal(again.status, 200, 'revoking should release the time');
  });

  test('a retry after a lost response returns the same booking, not a second one', async () => {
    const svc = makeService();
    const keys = await salon(svc);
    const link = await (await mint(svc, [{ startsAt: at(5, 11), endsAt: at(5, 12) }])).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);

    const body = JSON.stringify({
      slotId: page.slots[0].id, sealed, agreed: true, requestId: 'req-abc',
    });
    const send = () => svc.call(`/api/l/${link.token}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });

    const first = await (await send()).json();
    const second = await (await send()).json();

    assert.equal(second.bookingId, first.bookingId, 'the retry is the same booking');
    assert.equal(second.replayed, true);

    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.equal(bookings.length, 1, 'one person, one booking, one deposit');
  });

  test('a link is spent after its booking, so forwarding it takes nothing else', async () => {
    const svc = makeService();
    await salon(svc);
    const link = await (await mint(svc, [
      { startsAt: at(6, 10), endsAt: at(6, 11) },
      { startsAt: at(6, 14), endsAt: at(6, 15) },
    ])).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);

    const booked = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    });
    assert.equal(booked.status, 200);

    // Whoever it was forwarded to gets nothing.
    const reused = await svc.call(`/api/l/${link.token}`);
    assert.equal(reused.status, 404, 'a spent link is closed');
  });

  test('a failed claim leaves no ghost booking behind', async () => {
    const svc = makeService();
    await salon(svc);
    const link = await (await mint(svc, [{ startsAt: at(7, 11), endsAt: at(7, 12) }],
      { maxBookings: 3 })).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);

    const post = () => svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    });

    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 409, 'the second attempt loses the claim');

    // The batch writes the booking and the claim together, so the loser must not
    // leave a row behind. That is what burned slots with no booking before.
    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.equal(bookings.length, 1);
  });

  test('a booking can always be reached again after it is marked seen', async () => {
    const svc = makeService();
    await salon(svc);
    const link = await (await mint(svc, [{ startsAt: at(8, 11), endsAt: at(8, 12) }])).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);
    await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    });

    const { bookings } = await (await svc.authed('/api/bookings')).json();
    await svc.authed(`/api/bookings/${bookings[0].id}/seen`, { method: 'POST' });

    // The device died before it stored the booking locally. Under the old code
    // this row was unreachable forever — there was no other read path.
    const unseen = await (await svc.authed('/api/bookings')).json();
    assert.equal(unseen.bookings.length, 0);

    const everything = await (await svc.authed('/api/bookings?all=1')).json();
    assert.equal(everything.bookings.length, 1, 'nothing is ever unreachable');
    assert.ok(everything.bookings[0].seenAt > 0);
  });

  test('starting over stops the links that were sealed to the old key', async () => {
    const access = await makeAccess();
    try {
      forgetCerts();
      const svc = makeService({ access: true, deviceKey: undefined });
      const { deviceKey } = await (await svc.asHer('/api/setup/qr', await access.token())).json();
      const authed = (p, init = {}) => svc.call(p, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${deviceKey}`, ...(init.headers ?? {}) },
      });

      const keys = newSalonKeys();
      await authed('/api/salon', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: 'Give 48 hours notice.' }),
      });
      const link = await (await authed('/api/links', {
        method: 'POST',
        body: JSON.stringify({
          clientRef: 'r', serviceName: 'Colour', priceMinor: 9000,
          slots: [{ startsAt: at(9, 11), endsAt: at(9, 12) }],
        }),
      })).json();
      const page = await (await svc.call(`/api/l/${link.token}`)).json();
      const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);

      await svc.asHer('/api/setup/reset', await access.token(), { method: 'POST' });

      // Anyone still holding the page could previously keep booking for 21 days,
      // sealed to a key that no longer exists.
      const after = await svc.call(`/api/l/${link.token}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
      });
      assert.equal(after.status, 404);
    } finally {
      access.restore();
    }
  });

  test('the times a client is shown carry the zone they mean', async () => {
    const svc = makeService();
    await salon(svc);
    const link = await (await mint(svc, [{ startsAt: at(10, 11), endsAt: at(10, 12) }])).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    // Without this the page formats in the reader's zone, so a client abroad
    // books 12:00 for an 11:00 slot and both sides have written proof they were
    // right.
    assert.equal(page.tz, 'Europe/London');
  });

  test('prices are pence, so half a deposit is never half a penny', async () => {
    const svc = makeService();
    await salon(svc);
    const link = await (await mint(svc, [{ startsAt: at(11, 11), endsAt: at(11, 12) }],
      { priceMinor: 4500 })).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(page.priceMinor, 4500);
    assert.equal(Number.isInteger(page.priceMinor), true);
    assert.equal(page.priceMinor / 2, 2250, 'a 50% deposit stays exact');
  });
});

/**
 * Cancelling. An hour that can never be resold is a lost booking just as surely
 * as one that never arrived — `taken` used to be one-way, so a client who
 * booked by mistake destroyed that slot permanently.
 */
describe('cancelling', () => {
  const at = (days, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  // Hours from *now*, never calendar days. "Tomorrow at 11" is thirteen hours
  // away at 10pm and thirty-five at midnight, so a tier assertion written in the
  // evening starts failing after midnight. Learned the hard way, twice.
  const hoursOut = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

  async function booked({ hours = 120, maxBookings = 2 } = {}) {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: 'Give 48 hours notice.' }),
    });
    const link = await (await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({
        clientRef: 'ref-1', serviceName: 'Colour', priceMinor: 9000, maxBookings,
        slots: [{ startsAt: hoursOut(hours), endsAt: hoursOut(hours + 2) }],
      }),
    })).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);
    const res = await (await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true, requestId: 'r1' }),
    })).json();
    return { svc, link, page, sealed, booking: res };
  }

  test('the hour goes back on sale', async () => {
    const { svc, link, booking } = await booked();

    let page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(page.slots.length, 0, 'taken while the booking stands');

    const cancelled = await svc.call(`/api/c/${booking.cancelToken}`, { method: 'POST' });
    assert.equal(cancelled.status, 200);

    page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(page.slots.length, 1, 'and free again afterwards');
  });

  test('a cancelled booking is never replayed as if it were live', async () => {
    const { svc, link, page, sealed, booking } = await booked();
    await svc.call(`/api/c/${booking.cancelToken}`, { method: 'POST' });

    // Same requestId as the original. Returning the old booking here would tell
    // someone they are booked when they are not.
    const again = await (await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true, requestId: 'r1' }),
    })).json();
    assert.notEqual(again.bookingId, booking.bookingId, 'a fresh booking, not the dead one');
    assert.equal(again.replayed, undefined);
  });

  test('cancelling twice frees the hour once', async () => {
    const { svc, link, booking } = await booked();
    const first = await (await svc.call(`/api/c/${booking.cancelToken}`, { method: 'POST' })).json();
    const second = await (await svc.call(`/api/c/${booking.cancelToken}`, { method: 'POST' })).json();

    assert.equal(first.alreadyCancelled, false);
    assert.equal(second.alreadyCancelled, true, 'idempotent, not a second release');
    assert.equal(second.refundPct, first.refundPct, 'and the tier does not drift');

    const state = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.equal(state.slots.length, 1);
    assert.equal(state.bookedCount, undefined);
  });

  test('the notice tier is decided by the server, and frozen', async () => {
    // Offsets from *now*, not calendar days: "two days out at 11am" can be 36
    // hours away depending on the time of day, which is exactly the kind of
    // reasoning that should never decide someone's refund.
    const hoursOut = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

    async function cancelAt(hoursBefore) {
      const svc = makeService();
      const keys = newSalonKeys();
      await svc.authed('/api/salon', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: 'Give 48 hours notice.' }),
      });
      const link = await (await svc.authed('/api/links', {
        method: 'POST',
        body: JSON.stringify({
          clientRef: 'r', serviceName: 'Colour', priceMinor: 9000,
          slots: [{ startsAt: hoursOut(hoursBefore), endsAt: hoursOut(hoursBefore + 2) }],
        }),
      })).json();
      const page = await (await svc.call(`/api/l/${link.token}`)).json();
      const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);
      const b = await (await svc.call(`/api/l/${link.token}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
      })).json();
      return (await (await svc.call(`/api/c/${b.cancelToken}`, { method: 'POST' })).json()).refundPct;
    }

    assert.equal(await cancelAt(72), 100, 'three days out — full refund');
    assert.equal(await cancelAt(48.5), 100, 'just outside 48 hours');
    assert.equal(await cancelAt(47.5), 50, 'just inside 48 hours');
    assert.equal(await cancelAt(25), 50, 'still inside the middle tier');
    assert.equal(await cancelAt(23), 0, 'inside 24 hours — nothing comes back');
    assert.equal(await cancelAt(0.5), 0, 'half an hour before');
  });

  test('a client can see what cancelling would cost before pressing anything', async () => {
    const { svc, booking } = await booked({ hours: 12 });
    const preview = await (await svc.call(`/api/c/${booking.cancelToken}`)).json();
    assert.equal(preview.status, 'confirmed');
    assert.equal(preview.refundPct, 0, 'told up front, not after the fact');
    assert.equal(preview.serviceName, 'Colour');
    assert.equal(preview.tz, 'Europe/London');
  });

  test('she can cancel from the app, and it reaches her inbox as cancelled', async () => {
    const { svc, booking } = await booked();
    const res = await svc.authed(`/api/bookings/${booking.bookingId}/cancel`, { method: 'POST' });
    assert.equal(res.status, 200);

    const { bookings } = await (await svc.authed('/api/bookings?all=1')).json();
    assert.equal(bookings[0].status, 'cancelled');
    assert.equal(bookings[0].cancelledBy, 'salon');
    assert.ok(bookings[0].cancelledAt > 0);
  });

  test("a client's cancellation goes back into her inbox, so her diary hears about it", async () => {
    // Before, a booking she had already pulled in stayed in her diary as live
    // after the client cancelled: a no-show she would wait for.
    const { svc, booking } = await booked();
    const seen = await svc.authed(`/api/bookings/${booking.bookingId}/seen`, { method: 'POST' });
    assert.equal(seen.status, 200);
    assert.equal((await (await svc.authed('/api/bookings')).json()).bookings.length, 0);

    await svc.call(`/api/c/${booking.cancelToken}`, { method: 'POST' });
    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.deepEqual(bookings.map((b) => [b.id, b.status]), [[booking.bookingId, 'cancelled']]);
  });

  test('when she cancels, the hour is free for others but not offered back on the same link', async () => {
    // Before, cancelling in the app never reached the service at all. Now it
    // does — and calling a booking off must not let the same client book
    // straight back into the hour she has just called off.
    const { svc, link, booking } = await booked({ maxBookings: 1 });
    const res = await svc.authed(`/api/bookings/${booking.bookingId}/cancel`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await svc.call(`/api/l/${link.token}`)).status, 404, 'the old link is withdrawn');

    const again = await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({
        clientRef: 'ref-2', serviceName: 'Colour', priceMinor: 9000,
        slots: [{ startsAt: hoursOut(120), endsAt: hoursOut(122) }],
      }),
    });
    assert.equal(again.status, 200, 'and the hour can go to someone else');
  });

  test('a cancel token is good for exactly one booking and nothing else', async () => {
    const { svc } = await booked();
    assert.equal((await svc.call('/api/c/deadbeefdeadbeef', { method: 'POST' })).status, 404);
  });
});

/**
 * The cancellation terms, settled: the shipped default wording, two days notice.
 *
 * These assert the ARITHMETIC against a real price rather than the percentages
 * in isolation, because the percentages are a percentage of the deposit and the
 * prose is a percentage of the remaining cost — two different denominators that
 * happen to line up, and nothing except a test keeps them lined up.
 */
describe('what a cancellation actually costs', () => {
  const SERVICE_MINOR = 9000;   // £90
  const DEPOSIT_MINOR = 4500;   // 50%, which is what she takes

  async function refundPctAt(hoursBefore) {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Iris', publicKey: keys.publicKey,
        policy: 'If you need to cancel, please give at least 48 hours notice.',
      }),
    });
    const iso = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
    const link = await (await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({
        clientRef: 'r', serviceName: 'Full head colour', priceMinor: SERVICE_MINOR,
        slots: [{ startsAt: iso(hoursBefore), endsAt: iso(hoursBefore + 3) }],
      }),
    })).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);
    const booked = await (await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed, agreed: true }),
    })).json();
    return (await (await svc.call(`/api/c/${booked.cancelToken}`, { method: 'POST' })).json()).refundPct;
  }

  test('two days or more: the deposit comes back in full', async () => {
    const pct = await refundPctAt(50);
    assert.equal(pct, 100);
    assert.equal((DEPOSIT_MINOR * pct) / 100, 4500, 'the whole £45');
  });

  test('inside two days: she keeps half the deposit, which is half the remaining cost', async () => {
    // The prose says "50% of the remaining appointment cost". With £45 already
    // paid on a £90 service, the remaining cost is £45, so the charge is £22.50
    // — which is half the deposit. The two denominators agree here, and this is
    // the test that keeps them agreeing.
    const pct = await refundPctAt(30);
    assert.equal(pct, 50);
    const refunded = (DEPOSIT_MINOR * pct) / 100;
    const kept = DEPOSIT_MINOR - refunded;
    assert.equal(kept, 2250, 'she keeps £22.50');
    assert.equal(kept, (SERVICE_MINOR - DEPOSIT_MINOR) / 2, 'which is half the remaining cost');
  });

  test('inside 24 hours: nothing comes back', async () => {
    const pct = await refundPctAt(6);
    assert.equal(pct, 0);
  });

  test('the deposit is the ceiling of what the service can act on', async () => {
    // The prose says the full amount inside 24 hours — £90 on a £45 deposit. The
    // service can stop money going back; it cannot reach out and take more. The
    // rest is between her and the client, and the app must not imply otherwise.
    const pct = await refundPctAt(6);
    const collected = DEPOSIT_MINOR - (DEPOSIT_MINOR * pct) / 100;
    assert.equal(collected, DEPOSIT_MINOR);
    assert.ok(collected < SERVICE_MINOR, 'short of the full amount, by design');
  });

  test('exactly two days out still counts as two days', async () => {
    // Boundaries go the client's way, and a boundary that goes the other way is
    // the one people write reviews about.
    assert.equal(await refundPctAt(48.25), 100);
  });
});

describe('days off', () => {
  const hoursOut = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

  async function offered() {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', { method: 'PUT', body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }) });
    const link = await (await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({
        clientRef: 'ref-1', serviceName: 'Colour', priceMinor: 9000, maxBookings: 2,
        slots: [
          { startsAt: hoursOut(48), endsAt: hoursOut(50) },
          { startsAt: hoursOut(96), endsAt: hoursOut(98) },
        ],
      }),
    })).json();
    const block = (ranges) => svc.authed('/api/days-off', { method: 'PUT', body: JSON.stringify({ ranges }) });
    const view = async () => (await (await svc.call(`/api/l/${link.token}`)).json()).slots ?? [];
    const book = async (slotId, name = 'Sara') => svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId, sealed: pageSeal()(JSON.stringify({ name, phone: '07700900000' }), keys.publicKey), agreed: true }),
    });
    return { svc, link, block, view, book };
  }
  const day = (fromH, toH) => ({ from: hoursOut(fromH), to: hoursOut(toH) });

  test('a day she blocks disappears from links already sent, and cannot be booked', async () => {
    const { block, view, book } = await offered();
    const [first] = await view();
    assert.equal((await block([day(40, 60)])).status, 200);

    assert.equal((await view()).length, 1, 'only the hour off the blocked day is left');
    assert.equal((await book(first.id)).status, 409, 'a page opened before she blocked it cannot book it either');
  });

  test('opening the day again puts the hours back — nothing was thrown away', async () => {
    const { block, view } = await offered();
    await block([day(40, 60)]);
    await block([]);
    assert.equal((await view()).length, 2);
  });

  test('an hour freed by a client cancelling on a blocked day stays off', async () => {
    // The gap a one-off withdrawal would leave: the cancellation frees the
    // slot, and without the block it would go straight back on offer.
    const { svc, block, view, book } = await offered();
    const [first] = await view();
    const { cancelToken } = await (await book(first.id)).json();
    await block([day(40, 60)]);
    await svc.call(`/api/c/${cancelToken}`, { method: 'POST' });
    const left = await view();
    assert.equal(left.length, 1, 'the freed hour on the blocked day is not offered');
    assert.ok(Date.parse(left[0].startsAt) > Date.now() + 90 * 3_600_000, 'only the hour off the blocked day is');
  });

  test('a new link cannot offer an hour on a day off', async () => {
    const { svc, block } = await offered();
    await block([day(140, 170)]);
    const res = await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({ clientRef: 'r2', serviceName: 'Cut', slots: [{ startsAt: hoursOut(150), endsAt: hoursOut(151) }] }),
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'day off');
  });

  test('only her devices can set them, and only as real ranges', async () => {
    const { svc, block } = await offered();
    const stranger = await svc.call('/api/days-off', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ranges: [] }),
    });
    assert.equal(stranger.status, 401);
    assert.equal((await block([{ from: hoursOut(10), to: hoursOut(5) }])).status, 400);
  });
});

describe('a time that has already started', () => {
  test('is not offered and cannot be booked', async () => {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', { method: 'PUT', body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }) });
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const soon = new Date(Date.now() + 48 * 3_600_000).toISOString();
    const link = await (await svc.authed('/api/links', {
      method: 'POST',
      body: JSON.stringify({ clientRef: 'r', serviceName: 'Cut', maxBookings: 2, slots: [
        { startsAt: past, endsAt: new Date(Date.now() - 1_800_000).toISOString() },
        { startsAt: soon, endsAt: new Date(Date.now() + 49 * 3_600_000).toISOString() },
      ] }),
    })).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    assert.deepEqual(page.slots.map((s) => s.startsAt), [soon]);

    const gone = svc.env.DB._raw.prepare('SELECT id FROM slots WHERE starts_at = ?').get(past).id;
    const res = await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: gone, sealed: pageSeal()(JSON.stringify({ name: 'A', phone: '1' }), keys.publicKey) }),
    });
    assert.equal(res.status, 409);
  });
});

describe('a client cancelling between the fetch and the acknowledgement', () => {
  test('is not swallowed by the acknowledgement', async () => {
    const svc = makeService();
    const keys = newSalonKeys();
    await svc.authed('/api/salon', { method: 'PUT', body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey }) });
    const link = await (await svc.authed('/api/links', { method: 'POST', body: JSON.stringify({
      clientRef: 'r', serviceName: 'Cut',
      slots: [{ startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), endsAt: new Date(Date.now() + 73 * 3_600_000).toISOString() }],
    }) })).json();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const booked = await (await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed: pageSeal()(JSON.stringify({ name: 'A', phone: '1' }), keys.publicKey) }),
    })).json();

    // Her device fetched it as confirmed; the client cancels; then the ack arrives.
    await svc.call(`/api/c/${booked.cancelToken}`, { method: 'POST' });
    await svc.authed(`/api/bookings/${booked.bookingId}/seen`, { method: 'POST', body: JSON.stringify({ status: 'confirmed' }) });

    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.deepEqual(bookings.map((b) => b.status), ['cancelled'], 'still in the inbox, as cancelled');
  });
});
