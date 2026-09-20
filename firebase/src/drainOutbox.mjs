import {
  collection, query, where, orderBy, limit, getDocs, doc, runTransaction,
} from 'firebase/firestore';
import {
  claimable, afterAttempt, idempotencyKey, withinIdempotencyWindow, LEASE_MS,
} from './outbox.mjs';

/**
 * Drains the outbox.
 *
 * Claim under a lease, send, record the outcome. Nothing here runs in a request
 * path, and nothing here may happen after a response is sent — Cloud Functions
 * instances are frozen the instant they respond, so "send it after the 200" is
 * how a message quietly never happens.
 *
 * `send` is injected rather than imported so the tests drive real failure modes
 * — timeouts, permanent rejections, a provider that succeeds but whose
 * acknowledgement is lost — without a provider account.
 */
export async function drainOutbox(db, { send, now = Date.now(), batch = 20, salonPath = '' } = {}) {
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);
  const out = { sent: 0, retried: 0, dead: 0, deferred: 0, skipped: 0 };

  const due = await getDocs(query(
    collection(db, p('outbox')),
    where('state', '==', 'pending'),
    orderBy('nextAttemptAt'),
    limit(batch),
  ));

  for (const snap of due.docs) {
    const row = { id: snap.id, ...snap.data() };
    if (!claimable(row, now)) { out.skipped++; continue; }

    // A money row whose provider idempotency key may have been pruned is never
    // blind-retried — that is how one refund becomes two. Hand it to the
    // reconciler, which re-reads the truth from the provider instead.
    if (!withinIdempotencyWindow(row, now)) {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, p(`outbox/${row.id}`));
        const fresh = await tx.get(ref);
        if (!fresh.exists() || fresh.data().state !== 'pending') return;
        tx.update(ref, {
          state: 'needs_reconcile',
          reason: 'idempotency window expired — verify with the provider before retrying',
        });
      });
      out.deferred++;
      continue;
    }

    // Take the lease in its own transaction, so two consumers running at once
    // cannot both hand the same row to the provider.
    const claimed = await runTransaction(db, async (tx) => {
      const ref = doc(db, p(`outbox/${row.id}`));
      const fresh = await tx.get(ref);
      if (!fresh.exists()) return false;
      const current = fresh.data();
      if (!claimable({ ...current, id: row.id }, now)) return false;
      tx.update(ref, { leaseUntil: now + LEASE_MS, attempts: current.attempts ?? 0 });
      return true;
    });
    if (!claimed) { out.skipped++; continue; }

    // The send happens OUTSIDE any transaction. A transaction body re-runs on
    // contention, and a retried body that had called a provider would send
    // twice.
    let outcome;
    try {
      outcome = await send({ ...row, idempotencyKey: idempotencyKey(row) }) ?? { ok: true };
    } catch (err) {
      outcome = { ok: false, error: String(err?.message ?? err), permanent: err?.permanent === true };
    }

    // Recorded after the send returns, never before: the failure mode has to be
    // a possible duplicate, not a possible loss.
    const next = afterAttempt(row, outcome, now);
    await runTransaction(db, async (tx) => {
      const ref = doc(db, p(`outbox/${row.id}`));
      const fresh = await tx.get(ref);
      if (!fresh.exists()) return;
      tx.update(ref, next);
    });

    if (next.state === 'sent') out.sent++;
    else if (next.state === 'dead') out.dead++;
    else out.retried++;
  }

  return out;
}
