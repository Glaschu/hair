/**
 * The outbox: how a thing that must happen once actually happens once.
 *
 * The failure to design against is a booking that succeeds and a confirmation
 * that never sends — or worse, a deposit refunded twice because someone
 * retried. So the intent to send is written in the SAME transaction as the
 * thing that caused it, and a separate consumer drains it. Sending is never in
 * the request path: a provider outage cannot fail a booking, and a booking
 * cannot lose its send.
 *
 * The ordering rule that decides everything else: **the row is marked sent
 * AFTER the send returns**, never before. That makes the failure mode a
 * possible duplicate rather than a possible loss, and a duplicate is what
 * provider idempotency keys are for.
 */

/** Rows are claimed with a lease so two consumers cannot both send one. */
export const LEASE_MS = 60_000;

export const MAX_ATTEMPTS = 8;

/**
 * Stripe may prune an idempotency key after ~24 hours, and retries webhooks for
 * ~3 days. So a money row retried on day two presents a pruned key and Stripe
 * treats it as a NEW request — a second refund.
 *
 * Past this window a money row is never blind-retried. It goes to the
 * reconciler, which re-fetches the current state from Stripe and decides from
 * truth rather than from our memory of it.
 */
export const IDEMPOTENCY_WINDOW_MS = 20 * 60 * 60 * 1000;

/**
 * What each kind of message is allowed to risk.
 *
 * `movesMoney` is the only flag that matters: a duplicate "you're booked" text
 * is mildly annoying and a missing one is a no-show, so messages lean towards
 * sending again. A duplicate refund is somebody's money.
 */
export const KINDS = {
  confirm_client:  { movesMoney: false, maxAttempts: MAX_ATTEMPTS },
  remind_client:   { movesMoney: false, maxAttempts: 4 },
  notify_stylist:  { movesMoney: false, maxAttempts: MAX_ATTEMPTS },
  cancel_notice:   { movesMoney: false, maxAttempts: MAX_ATTEMPTS },
  refund_deposit:  { movesMoney: true,  maxAttempts: 5 },
};

export function policyFor(kind) {
  return KINDS[kind] ?? { movesMoney: true, maxAttempts: 1 };
}

/**
 * A stable key for the provider, derived rather than generated.
 *
 * Deterministic so a retry presents the SAME key and the provider dedupes it.
 * A random key per attempt would turn every retry into a fresh charge.
 */
export function idempotencyKey(row) {
  return `${row.kind}:${row.subjectId}`;
}

/**
 * Exponential backoff with jitter, so a provider coming back from an outage is
 * not hit by every pending row in the same second.
 */
export function backoffMs(attempts, rand = Math.random) {
  const base = Math.min(2 ** attempts * 1000, 15 * 60 * 1000);
  return Math.round(base * (0.5 + rand() * 0.5));
}

/** Rows this consumer may pick up right now. */
export function claimable(row, now) {
  if (row.state !== 'pending') return false;
  if ((row.nextAttemptAt ?? 0) > now) return false;
  if ((row.leaseUntil ?? 0) > now) return false;
  return true;
}

/**
 * Whether a row is still safe to hand to the provider.
 *
 * Only money rows are gated: a confirmation text sent late is still worth
 * sending, but a refund whose idempotency key may have been pruned is not
 * something to guess about.
 */
export function withinIdempotencyWindow(row, now, window = IDEMPOTENCY_WINDOW_MS) {
  if (!policyFor(row.kind).movesMoney) return true;
  return now - row.createdAt < window;
}

/**
 * The row as it should look after one attempt.
 *
 * Pure, so every branch is reachable in a test without a provider, a clock or a
 * database.
 */
export function afterAttempt(row, outcome, now, rand = Math.random) {
  const attempts = (row.attempts ?? 0) + 1;
  const { maxAttempts } = policyFor(row.kind);

  if (outcome.ok) {
    return { state: 'sent', attempts, sentAt: now, leaseUntil: 0, lastError: null };
  }

  // Some failures are the provider telling us this will never work: a malformed
  // address, a number that does not exist. Retrying is just noise, and it delays
  // the moment she finds out.
  if (outcome.permanent) {
    return {
      state: 'dead', attempts, leaseUntil: 0,
      lastError: outcome.error ?? 'permanent failure',
      deadAt: now, deadReason: 'permanent',
    };
  }

  if (attempts >= maxAttempts) {
    return {
      state: 'dead', attempts, leaseUntil: 0,
      lastError: outcome.error ?? 'gave up',
      deadAt: now, deadReason: 'exhausted',
    };
  }

  return {
    state: 'pending', attempts, leaseUntil: 0,
    nextAttemptAt: now + backoffMs(attempts, rand),
    lastError: outcome.error ?? 'failed',
  };
}

/**
 * Rows a human has to look at.
 *
 * Silence is how these systems actually lose things, so a dead letter is not a
 * log line — it is something the app shows her: "3 confirmations didn't send"
 * beats finding out when a client doesn't turn up.
 */
export function needsAttention(rows, now) {
  return rows.filter((r) =>
    r.state === 'dead' ||
    r.state === 'needs_reconcile' ||
    (r.state === 'pending' && policyFor(r.kind).movesMoney &&
     !withinIdempotencyWindow(r, now)));
}
