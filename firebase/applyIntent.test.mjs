import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { applyIntent } from './src/applyIntent.mjs';

/**
 * The decision is tested exhaustively and without a database in resolve.test.mjs.
 * This is the other half: that the decision is actually *enforced* — atomically,
 * once, and against real Firestore semantics rather than a mental model of them.
 */

let env, db;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;
const DATE = '2026-10-04';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'iris-resolver-test',
    firestore: { rules: 'rules_version = "2"; service cloud.firestore { match /{d=**} { allow read, write: if true; } }',
                 host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  // The resolver runs with admin privileges, so rules are deliberately not in
  // play here — that is precisely why it needs its own tests.
  db = env.unauthenticatedContext().firestore();
});

const writeIntent = (id, over = {}) => setDoc(doc(db, `intents/${id}`), {
  op: 'book',
  date: DATE,
  target: { s: NOW + h(26), e: NOW + h(28) },
  basisVersion: 0,
  clientMadeAt: NOW - h(1),
  serverReceivedAt: NOW,
  result: null,
  ...over,
});

const readDay = async () => (await getDoc(doc(db, `days/${DATE}`))).data();
const readIntent = async (id) => (await getDoc(doc(db, `intents/${id}`))).data();

describe('applying an intent for real', () => {
  test('a clean intent lands on the day and records its outcome', async () => {
    await writeIntent('i1');
    const out = await applyIntent(db, { intentId: 'i1', now: NOW });

    assert.equal(out.action, 'apply');
    const day = await readDay();
    assert.equal(day.intervals.length, 1);
    assert.equal(day.version, 1);
    assert.equal((await readIntent('i1')).result, 'apply');
  });

  test('running it twice changes nothing the second time', async () => {
    // Firestore triggers are at-least-once, so a second delivery is routine.
    await writeIntent('i1');
    await applyIntent(db, { intentId: 'i1', now: NOW });
    const second = await applyIntent(db, { intentId: 'i1', now: NOW });

    assert.equal(second.action, 'noop');
    assert.equal(second.reason, 'already_resolved');
    const day = await readDay();
    assert.equal(day.intervals.length, 1, 'not booked twice');
    assert.equal(day.version, 1, 'and the version did not move');
  });

  test('two intents for the same hour: exactly one wins', async () => {
    await writeIntent('a');
    await writeIntent('b');

    const [first, second] = await Promise.all([
      applyIntent(db, { intentId: 'a', now: NOW }),
      applyIntent(db, { intentId: 'b', now: NOW }),
    ]);

    const outcomes = [first.action, second.action].sort();
    assert.deepEqual(outcomes, ['apply', 'reject'],
      'one applied, one refused — never both');

    const day = await readDay();
    assert.equal(day.intervals.length, 1);
    assert.equal(day.version, 1);
  });

  test('a rejection is written down, not just returned', async () => {
    // A refusal she never sees is indistinguishable from a booking that
    // quietly vanished.
    await setDoc(doc(db, `days/${DATE}`), {
      version: 3,
      intervals: [{ id: 'paid', s: NOW + h(26), e: NOW + h(28), kind: 'appointment' }],
    });
    await writeIntent('i1', { basisVersion: 3 });

    const out = await applyIntent(db, { intentId: 'i1', now: NOW });
    assert.equal(out.action, 'reject');

    const stored = await readIntent('i1');
    assert.equal(stored.result, 'reject');
    assert.equal(stored.reason, 'conflict');
    assert.equal(stored.conflictWith, 'paid', 'she can be told what took it');
    assert.ok(stored.resolvedAt, 'and when it was decided');
  });

  test('a cancelled booking is not resurrected by a queued write', async () => {
    // The whole hazard, through the real transaction: the hour is free because
    // the booking was cancelled and refunded, so every other check passes.
    await setDoc(doc(db, 'bookings/b1'), { status: 'cancelled', version: 2 });
    await setDoc(doc(db, `days/${DATE}`), { version: 5, intervals: [] });
    await writeIntent('i1', { op: 'move', bookingId: 'b1', basisVersion: 5 });

    const out = await applyIntent(db, { intentId: 'i1', now: NOW });
    assert.equal(out.action, 'reject');
    assert.equal(out.reason, 'booking_cancelled');

    const day = await readDay();
    assert.equal(day.intervals.length, 0, 'the calendar is untouched');
    assert.equal(day.version, 5, 'and so is the version');
  });

  test('an intent that has vanished is a no-op, not a crash', async () => {
    const out = await applyIntent(db, { intentId: 'ghost', now: NOW });
    assert.equal(out.action, 'noop');
    assert.equal(out.reason, 'intent_missing');
  });

  test('a stale intent is reviewed, and the day is left alone', async () => {
    await writeIntent('i1', { clientMadeAt: NOW - h(72), serverReceivedAt: NOW });
    const out = await applyIntent(db, { intentId: 'i1', now: NOW });

    assert.equal(out.action, 'review');
    assert.equal((await getDoc(doc(db, `days/${DATE}`))).exists(), false,
      'nothing was written for a decision that needs a human');
  });
});
