import {
  claimable, afterAttempt, idempotencyKey, withinIdempotencyWindow, LEASE_MS, policyFor,
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
 *
 * Admin SDK, because Cloud Functions run the Admin SDK. Testing against the
 * client SDK would have proved something about code that never ships.
 */
export async function drainOutbox(db, { send, now = Date.now(), batch = 20, salonPath = '', kind } = {}) {
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);
  const out = { sent: 0, retried: 0, dead: 0, deferred: 0, skipped: 0 };

  // One kind at a time when asked — refunds are drained on their own schedule,
  // and must never sit behind a queue of messages that have no provider yet.
  // Two equality filters and an in-memory sort rather than orderBy, because
  // that pairing needs no composite index and cannot fail in production on an
  // index nobody created.
  const docs = kind
    ? (await db.collection(p('outbox')).where('kind', '==', kind).where('state', '==', 'pending').get())
      .docs.sort((a, b) => (a.data().nextAttemptAt ?? 0) - (b.data().nextAttemptAt ?? 0)).slice(0, batch)
    : (await db.collection(p('outbox'))
      .where('state', '==', 'pending')
      .orderBy('nextAttemptAt')
      .limit(batch)
      .get()).docs;

  for (const snap of docs) {
    const row = { id: snap.id, ...snap.data() };
    if (!claimable(row, now)) { out.skipped++; continue; }

    // A money row whose provider idempotency key may have been pruned is never
    // blind-retried — that is how one refund becomes two. Hand it to the
    // reconciler, which re-reads the truth from the provider instead.
    if (!withinIdempotencyWindow(row, now)) {
      await db.runTransaction(async (tx) => {
        const ref = db.doc(p(`outbox/${row.id}`));
        const fresh = await tx.get(ref);
        if (!fresh.exists || fresh.data().state !== 'pending') return;
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
    const claimed = await db.runTransaction(async (tx) => {
      const ref = db.doc(p(`outbox/${row.id}`));
      const fresh = await tx.get(ref);
      if (!fresh.exists) return false;
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
    await db.runTransaction(async (tx) => {
      const ref = db.doc(p(`outbox/${row.id}`));
      const fresh = await tx.get(ref);
      if (!fresh.exists) return;
      tx.update(ref, next);
    });

    if (next.state === 'sent') out.sent++;
    else if (next.state === 'dead') out.dead++;
    else out.retried++;
  }

  return out;
}


/** How long an unsent message row is kept before it is cleared away. */
export const STALE_MESSAGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Clears out message rows nothing will ever send.
 *
 * Confirmations and notices are queued on every booking and cancellation, but
 * this deployment has no text or email provider yet, so they sat `pending` for
 * ever and the collection only grew. Old ones are removed. NEVER money: a
 * refund row is evidence, and stays until it is sent or she has dealt with it.
 */
export async function tidyOutbox(db, { now = Date.now(), salonPath = '', pageSize = 200, maxPages = 5 } = {}) {
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);
  // Only pending rows are candidates, so ask for only those — sent and dead
  // rows are kept, and a window that filled with them used to stall the tidy
  // for good. Paged, oldest first, because the money rows it must step over
  // can still fill a page.
  let removed = 0;
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    let q = db.collection(p('outbox'))
      .where('state', '==', 'pending')
      .where('createdAt', '<', now - STALE_MESSAGE_MS)
      .orderBy('createdAt')
      .limit(pageSize);
    if (after) q = q.startAfter(after);
    const snap = await q.get();
    const stale = snap.docs.filter((d) => !policyFor(d.data().kind).movesMoney);
    await Promise.all(stale.map((d) => d.ref.delete()));
    removed += stale.length;
    if (snap.size < pageSize) break;
    after = snap.docs[snap.docs.length - 1];
  }
  return { removed };
}
