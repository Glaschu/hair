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
      durationMins: 30, price: 45,
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
      body: JSON.stringify({ slotId: page.slots[0].id, sealed }),
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
      body: JSON.stringify({ slotId: 'anything', sealed: 'x' }),
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

    assert.equal(svc.env.DB._raw.prepare('SELECT COUNT(*) n FROM bookings').get().n, 0);
  });
});

describe('self-hosting', () => {
  test('says what it is, so the app can spot a stale deployment', async () => {
    const { svc } = await setUpSalon();
    const res = await svc.call('/api/version');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { service: 'iris-booking', api: 1 });
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
      clientRef: 'ref-2', serviceName: 'Consultation', durationMins: 30, price: 45,
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
        clientRef: 'ref-1', serviceName: 'Colour', durationMins: 60, price: 90,
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

  test('a booking that did not agree is not marked as having agreed', async () => {
    const { svc, link } = await withPolicy();
    const page = await (await svc.call(`/api/l/${link.token}`)).json();
    const sealed = pageSeal()(JSON.stringify({ name: 'Sara', phone: '07700900000' }), page.publicKey);
    await svc.call(`/api/l/${link.token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId: page.slots[0].id, sealed }),
    });
    const { bookings } = await (await svc.authed('/api/bookings')).json();
    assert.equal(bookings[0].agreedAt, null);
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
