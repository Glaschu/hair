import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterAttempt, backoffMs, claimable, idempotencyKey, needsAttention,
  withinIdempotencyWindow, policyFor, IDEMPOTENCY_WINDOW_MS, MAX_ATTEMPTS,
} from './src/outbox.mjs';

/**
 * The outbox exists so that a thing which must happen once actually happens
 * once. These tests are about the two ways that fails: it never happens, or it
 * happens twice and one of those times was somebody's money.
 */

const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;

const row = (over = {}) => ({
  id: 'o1',
  kind: 'confirm_client',
  subjectId: 'bk_123',
  state: 'pending',
  attempts: 0,
  createdAt: NOW - h(1),
  nextAttemptAt: NOW - 1000,
  leaseUntil: 0,
  ...over,
});

describe('the idempotency key is derived, not generated', () => {
  test('a retry presents the same key, so the provider can dedupe it', () => {
    const a = idempotencyKey(row({ attempts: 0 }));
    const b = idempotencyKey(row({ attempts: 4 }));
    assert.equal(a, b);
    assert.equal(a, 'confirm_client:bk_123');
  });

  test('different work on the same subject gets different keys', () => {
    // Otherwise a refund would dedupe against the confirmation that preceded it
    // and silently never happen.
    assert.notEqual(
      idempotencyKey(row({ kind: 'confirm_client' })),
      idempotencyKey(row({ kind: 'refund_deposit' })),
    );
  });
});

describe('claiming', () => {
  test('a row that is not yet due is left alone', () => {
    assert.equal(claimable(row({ nextAttemptAt: NOW + h(1) }), NOW), false);
  });

  test('a leased row is not picked up by a second consumer', () => {
    assert.equal(claimable(row({ leaseUntil: NOW + 30_000 }), NOW), false);
  });

  test('an expired lease is reclaimable, so a dead consumer cannot strand a row', () => {
    assert.equal(claimable(row({ leaseUntil: NOW - 1 }), NOW), true);
  });

  test('sent and dead rows are never reclaimed', () => {
    assert.equal(claimable(row({ state: 'sent' }), NOW), false);
    assert.equal(claimable(row({ state: 'dead' }), NOW), false);
  });
});

describe('after an attempt', () => {
  test('success marks it sent and stamps when', () => {
    const next = afterAttempt(row(), { ok: true }, NOW);
    assert.equal(next.state, 'sent');
    assert.equal(next.sentAt, NOW);
    assert.equal(next.leaseUntil, 0, 'and releases the lease');
  });

  test('a transient failure schedules another go, further out each time', () => {
    const first = afterAttempt(row({ attempts: 0 }), { ok: false }, NOW, () => 1);
    const later = afterAttempt(row({ attempts: 5 }), { ok: false }, NOW, () => 1);
    assert.equal(first.state, 'pending');
    assert.ok(later.nextAttemptAt > first.nextAttemptAt, 'backoff grows');
  });

  test('a permanent failure stops immediately rather than retrying into silence', () => {
    // A malformed number will not start working on the fourth go, and retrying
    // only delays the moment she finds out.
    const next = afterAttempt(row(), { ok: false, permanent: true, error: 'bad number' }, NOW);
    assert.equal(next.state, 'dead');
    assert.equal(next.deadReason, 'permanent');
    assert.equal(next.attempts, 1, 'without burning the budget first');
  });

  test('it gives up eventually, and says so', () => {
    const next = afterAttempt(row({ attempts: MAX_ATTEMPTS - 1 }), { ok: false }, NOW);
    assert.equal(next.state, 'dead');
    assert.equal(next.deadReason, 'exhausted');
  });

  test('money gives up sooner than a text message', () => {
    // Five attempts on a refund, eight on a confirmation: the cost of one more
    // try is not the same in both directions.
    assert.ok(policyFor('refund_deposit').maxAttempts < policyFor('confirm_client').maxAttempts);
    assert.equal(afterAttempt(row({ kind: 'refund_deposit', attempts: 4 }), { ok: false }, NOW).state, 'dead');
  });

  test('an unknown kind is treated as money and tried once', () => {
    // Failing safe: a kind nobody wrote a policy for must not be retried into a
    // duplicate charge.
    const p = policyFor('mystery_transfer');
    assert.equal(p.movesMoney, true);
    assert.equal(p.maxAttempts, 1);
  });
});

describe('backoff', () => {
  test('is jittered, so a recovering provider is not hit by everything at once', () => {
    const low = backoffMs(4, () => 0);
    const high = backoffMs(4, () => 1);
    assert.ok(high > low);
  });

  test('is capped, so a row does not drift to a retry next Tuesday', () => {
    assert.ok(backoffMs(30, () => 1) <= 15 * 60 * 1000);
  });
});

describe("the provider's idempotency key expires before its own retries stop", () => {
  test('a fresh money row is safe to send', () => {
    assert.equal(withinIdempotencyWindow(row({ kind: 'refund_deposit', createdAt: NOW - h(1) }), NOW), true);
  });

  test('a money row older than the window is NOT retried blindly', () => {
    // This is the whole point. Stripe may prune the key after ~24 hours but
    // retries webhooks for ~3 days, so a refund retried on day two presents a
    // pruned key and is treated as a brand new request — a second refund.
    const stale = row({ kind: 'refund_deposit', createdAt: NOW - IDEMPOTENCY_WINDOW_MS - 1 });
    assert.equal(withinIdempotencyWindow(stale, NOW), false);
  });

  test('a message that old is still worth sending', () => {
    const stale = row({ kind: 'confirm_client', createdAt: NOW - h(48) });
    assert.equal(withinIdempotencyWindow(stale, NOW), true,
      'a late confirmation is still a confirmation');
  });
});

describe('what a human is shown', () => {
  test('dead letters, reconcile flags and expired money rows all surface', () => {
    // Silence is how these systems actually lose things: "3 confirmations
    // didn't send" beats finding out when a client doesn't turn up.
    const rows = [
      row({ id: 'ok', state: 'sent' }),
      row({ id: 'waiting', state: 'pending', nextAttemptAt: NOW + h(1) }),
      row({ id: 'gaveup', state: 'dead' }),
      row({ id: 'check', state: 'needs_reconcile' }),
      row({ id: 'stalemoney', kind: 'refund_deposit', createdAt: NOW - h(48) }),
    ];
    assert.deepEqual(
      needsAttention(rows, NOW).map((r) => r.id).sort(),
      ['check', 'gaveup', 'stalemoney'],
    );
  });

  test('a row merely waiting its turn is not an alarm', () => {
    assert.deepEqual(needsAttention([row({ state: 'pending', nextAttemptAt: NOW + h(2) })], NOW), []);
  });
});
