import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { drainOutbox } from './src/drainOutbox.mjs';

/**
 * The state machine is tested exhaustively and without a database in
 * outbox.test.mjs. This is the half only a real database can show: that a row
 * is handed to the provider once, that a crash mid-flight costs a duplicate
 * rather than a loss, and that money past its idempotency window is never
 * quietly sent again.
 */

let env, db;
const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'iris-outbox-test',
    firestore: {
      rules: 'rules_version = "2"; service cloud.firestore { match /{d=**} { allow read, write: if true; } }',
      host: '127.0.0.1', port: 8080,
    },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  db = env.unauthenticatedContext().firestore();
});

const put = (id, over = {}) => setDoc(doc(db, `outbox/${id}`), {
  kind: 'confirm_client',
  subjectId: 'bk_1',
  state: 'pending',
  attempts: 0,
  createdAt: NOW - h(1),
  nextAttemptAt: NOW - 1000,
  leaseUntil: 0,
  ...over,
});

const read = async (id) => (await getDoc(doc(db, `outbox/${id}`))).data();

describe('draining', () => {
  test('a due row is sent once and marked', async () => {
    await put('o1');
    const seen = [];
    const out = await drainOutbox(db, { now: NOW, send: async (r) => { seen.push(r); return { ok: true }; } });

    assert.equal(out.sent, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].idempotencyKey, 'confirm_client:bk_1');
    assert.equal((await read('o1')).state, 'sent');
  });

  test('draining again sends nothing — the row is done', async () => {
    await put('o1');
    await drainOutbox(db, { now: NOW, send: async () => ({ ok: true }) });

    let calls = 0;
    await drainOutbox(db, { now: NOW, send: async () => { calls++; return { ok: true }; } });
    assert.equal(calls, 0);
  });

  test('two consumers running at once hand the row over once', async () => {
    await put('o1');
    let calls = 0;
    const send = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { ok: true }; };

    await Promise.all([
      drainOutbox(db, { now: NOW, send }),
      drainOutbox(db, { now: NOW, send }),
    ]);
    assert.equal(calls, 1, 'the lease is what stops the second one');
  });

  test('a row not yet due is left where it is', async () => {
    await put('later', { nextAttemptAt: NOW + h(2) });
    let calls = 0;
    await drainOutbox(db, { now: NOW, send: async () => { calls++; return { ok: true }; } });
    assert.equal(calls, 0);
    assert.equal((await read('later')).state, 'pending');
  });

  test('a failure schedules another attempt rather than losing the message', async () => {
    await put('o1');
    await drainOutbox(db, { now: NOW, send: async () => ({ ok: false, error: 'timeout' }) });

    const after = await read('o1');
    assert.equal(after.state, 'pending');
    assert.equal(after.attempts, 1);
    assert.ok(after.nextAttemptAt > NOW);
    assert.equal(after.leaseUntil, 0, 'and the lease is released so it can be retried');
  });

  test('a thrown provider error is a failure, not a crashed drain', async () => {
    await put('o1');
    await put('o2', { subjectId: 'bk_2' });
    const out = await drainOutbox(db, {
      now: NOW,
      send: async (r) => { if (r.subjectId === 'bk_1') throw new Error('socket hung up'); return { ok: true }; },
    });
    assert.equal(out.sent, 1, 'the second row still went');
    assert.equal((await read('o1')).lastError, 'socket hung up');
  });

  test('a provider that succeeds but whose acknowledgement is lost costs a duplicate, never a loss', async () => {
    // The row is marked AFTER the send returns. So a crash in between means we
    // send again — which is exactly why the key is derived and stable, and why
    // messages tolerate it.
    await put('o1');
    let delivered = 0;
    await drainOutbox(db, {
      now: NOW,
      send: async () => { delivered++; throw new Error('ack lost'); },
    });
    assert.equal((await read('o1')).state, 'pending', 'still queued, not lost');

    await drainOutbox(db, {
      now: NOW + h(1),
      send: async () => { delivered++; return { ok: true }; },
    });
    assert.equal(delivered, 2, 'sent twice');
    assert.equal((await read('o1')).state, 'sent');
  });

  test('a permanent failure is dead on the first attempt', async () => {
    await put('o1');
    await drainOutbox(db, {
      now: NOW,
      send: async () => { const e = new Error('unreachable number'); e.permanent = true; throw e; },
    });
    const after = await read('o1');
    assert.equal(after.state, 'dead');
    assert.equal(after.deadReason, 'permanent');
  });
});

describe('money past its idempotency window', () => {
  test('is never sent again — it goes to the reconciler', async () => {
    // Stripe may prune the key after ~24h but retries webhooks for ~3 days, so
    // a blind retry on day two is a second refund.
    await put('r1', { kind: 'refund_deposit', createdAt: NOW - h(48) });
    let calls = 0;
    const out = await drainOutbox(db, { now: NOW, send: async () => { calls++; return { ok: true }; } });

    assert.equal(calls, 0, 'the provider is not called');
    assert.equal(out.deferred, 1);
    const after = await read('r1');
    assert.equal(after.state, 'needs_reconcile');
    assert.match(after.reason, /verify with the provider/);
  });

  test('a fresh refund still sends normally', async () => {
    await put('r1', { kind: 'refund_deposit', createdAt: NOW - h(1) });
    const out = await drainOutbox(db, { now: NOW, send: async () => ({ ok: true }) });
    assert.equal(out.sent, 1);
  });

  test('a message that old still sends, because a late confirmation is still a confirmation', async () => {
    await put('m1', { kind: 'confirm_client', createdAt: NOW - h(48) });
    const out = await drainOutbox(db, { now: NOW, send: async () => ({ ok: true }) });
    assert.equal(out.sent, 1);
  });
});

describe('nothing is left invisible', () => {
  test('every row ends in a state a human can be shown', async () => {
    await put('good');
    await put('bad', { subjectId: 'bk_bad', attempts: 7 });
    await put('stale', { kind: 'refund_deposit', subjectId: 'bk_r', createdAt: NOW - h(48) });

    await drainOutbox(db, {
      now: NOW,
      send: async (r) => (r.subjectId === 'bk_bad' ? { ok: false } : { ok: true }),
    });

    const all = await getDocs(collection(db, 'outbox'));
    const states = Object.fromEntries(all.docs.map((d) => [d.id, d.data().state]));
    assert.deepEqual(states, { good: 'sent', bad: 'dead', stale: 'needs_reconcile' });
    // No row is still 'pending' with nobody coming back for it, and none has
    // silently disappeared — which is the only way this design loses something.
  });
});
