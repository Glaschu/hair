import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySignature, readEvent, sign, parseSignatureHeader, TOLERANCE_SECONDS,
} from './src/stripeWebhook.mjs';

/**
 * The door. Everything behind it moves money, and the endpoint is necessarily
 * public, so the signature check is the only thing between a stranger and the
 * ability to confirm bookings or trigger refunds.
 *
 * No Stripe CLI here — the signatures are constructed with the same scheme
 * Stripe uses, which is what lets the awkward cases be built exactly: a
 * timestamp from the future, a rotation with both secrets live, a body altered
 * by one byte.
 */

const SECRET = 'whsec_testsecretvalue';
const OTHER = 'whsec_adifferentsecret';
const NOW = 1_790_000_000;

const body = (over = {}) => JSON.stringify({
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', payment_status: 'paid' } }, ...over,
});

const header = (raw, secret = SECRET, t = NOW) => `t=${t},v1=${sign(raw, secret, t)}`;

describe('a genuine event', () => {
  test('is accepted', () => {
    const raw = body();
    assert.deepEqual(verifySignature(raw, header(raw), SECRET, { now: NOW }), { ok: true });
  });

  test('is parsed only after the signature checks out', () => {
    // Order matters: a hostile body must never reach a JSON parser on an
    // unauthenticated request.
    const out = readEvent(body(), header(body()), SECRET, { now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.event.id, 'evt_1');
  });

  test('a valid signature over something that is not an event is still refused', () => {
    const raw = JSON.stringify({ hello: 'world' });
    const out = readEvent(raw, header(raw), SECRET, { now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'not_an_event');
  });
});

describe('a forgery', () => {
  test('signed with the wrong secret is refused', () => {
    const raw = body();
    const out = verifySignature(raw, header(raw, OTHER), SECRET, { now: NOW });
    assert.equal(out.reason, 'signature_mismatch');
  });

  test('one altered byte breaks it', () => {
    // The attack this stops: a real event, captured, with the amount edited.
    const raw = body();
    const tampered = raw.replace('"paid"', '"paidx"');
    assert.equal(verifySignature(tampered, header(raw), SECRET, { now: NOW }).ok, false);
  });

  test('a body re-serialised rather than passed through raw does not verify', () => {
    // Why the handler must take the RAW bytes. Parsing and re-stringifying
    // changes key order and whitespace — and the usual "fix" for that is to
    // stop verifying.
    const raw = body();
    const reserialised = JSON.stringify(JSON.parse(raw), null, 2);
    assert.equal(verifySignature(reserialised, header(raw), SECRET, { now: NOW }).ok, false);
  });

  test('no signature, no timestamp, no secret — each refused by name', () => {
    const raw = body();
    assert.equal(verifySignature(raw, `t=${NOW}`, SECRET, { now: NOW }).reason, 'no_signature');
    assert.equal(verifySignature(raw, `v1=abc`, SECRET, { now: NOW }).reason, 'no_timestamp');
    assert.equal(verifySignature(raw, header(raw), [], { now: NOW }).reason, 'no_secret_configured');
  });

  test('an empty secret is not a secret', () => {
    // Failing open here would mean an unconfigured deployment accepting anything.
    const raw = body();
    assert.equal(verifySignature(raw, header(raw), ['', null, undefined], { now: NOW }).ok, false);
  });
});

describe('replay', () => {
  test('a captured event resent days later is outside tolerance', () => {
    const raw = body();
    const old = header(raw, SECRET, NOW - 4 * 86_400);
    assert.equal(verifySignature(raw, old, SECRET, { now: NOW }).reason, 'timestamp_outside_tolerance');
  });

  test('the window is Stripe\'s five minutes, checked at both edges', () => {
    const raw = body();
    const at = (offset) => verifySignature(raw, header(raw, SECRET, NOW + offset), SECRET, { now: NOW }).ok;
    assert.equal(at(-(TOLERANCE_SECONDS - 5)), true);
    assert.equal(at(-(TOLERANCE_SECONDS + 5)), false);
  });

  test('a timestamp from the future is refused too', () => {
    // A skewed clock somewhere. Trusting it would widen the replay window
    // rather than close it.
    const raw = body();
    assert.equal(verifySignature(raw, header(raw, SECRET, NOW + 3600), SECRET, { now: NOW }).ok, false);
  });

  test('a legitimate redelivery inside the window still verifies', () => {
    // Stripe retries for about three days, and each retry is freshly signed —
    // so recency is about the SIGNATURE, not about how many times we have seen
    // the event. Deduplication is the handler's job, not this one's.
    const raw = body();
    const h = header(raw, SECRET, NOW - 60);
    for (let i = 0; i < 5; i++) {
      assert.equal(verifySignature(raw, h, SECRET, { now: NOW }).ok, true);
    }
  });
});

describe('rotating the signing secret', () => {
  test('both secrets are accepted during the overlap', () => {
    // The point of a rotation: both live for a window, so nothing is dropped
    // while the swap happens.
    const raw = body();
    assert.equal(verifySignature(raw, header(raw, OTHER), [SECRET, OTHER], { now: NOW }).ok, true);
    assert.equal(verifySignature(raw, header(raw, SECRET), [SECRET, OTHER], { now: NOW }).ok, true);
  });

  test('the retired one stops working once it is removed', () => {
    const raw = body();
    assert.equal(verifySignature(raw, header(raw, SECRET), [OTHER], { now: NOW }).ok, false);
  });

  test('a header carrying several v1 values verifies if any matches', () => {
    // Stripe sends one per active secret on the endpoint.
    const raw = body();
    const multi = `t=${NOW},v1=${sign(raw, OTHER, NOW)},v1=${sign(raw, SECRET, NOW)}`;
    assert.equal(verifySignature(raw, multi, SECRET, { now: NOW }).ok, true);
  });

  test('several wrong v1 values do not add up to a right one', () => {
    const raw = body();
    const multi = `t=${NOW},v1=deadbeef,v1=${sign(raw, OTHER, NOW)}`;
    assert.equal(verifySignature(raw, multi, SECRET, { now: NOW }).ok, false);
  });
});

describe('the header itself', () => {
  test('is parsed the way Stripe sends it', () => {
    const parsed = parseSignatureHeader('t=123,v1=aaa,v1=bbb,v0=ignored');
    assert.equal(parsed.t, 123);
    assert.deepEqual(parsed.v1, ['aaa', 'bbb']);
  });

  test('rubbish parses to nothing rather than throwing', () => {
    for (const h of ['', null, undefined, 'garbage', 't=,v1=']) {
      assert.doesNotThrow(() => parseSignatureHeader(h));
    }
  });

  test('v0 is ignored — it is the test-mode scheme, not the live one', () => {
    assert.deepEqual(parseSignatureHeader('t=123,v0=aaa').v1, []);
  });
});
