import { decide, applied } from './resolve.mjs';

/**
 * Applies one intent, atomically.
 *
 * WRITTEN FOR THE ADMIN SDK, because that is what Cloud Functions run. The
 * earlier version of this file used the client SDK, which meant the code these
 * tests proved was not the code that would ship — the two differ in small ways
 * that matter (`snap.exists` is a property here and a method there), so a green
 * suite would have said nothing about production.
 *
 * The pure decision lives in resolve.mjs and is SDK-free either way.
 *
 * Three things the transaction body must never do, because Firestore re-runs it
 * on contention and a retried body that did any of them would corrupt state:
 *
 *   - call out to anything (Stripe, a provider, a clock we care about)
 *   - generate an id that has to be stable
 *   - mutate anything in the enclosing scope
 *
 * So `now` and every id are computed once, before the transaction, and passed
 * in. `applied()` returns a new day rather than editing the one it was handed,
 * for the same reason.
 */
export async function applyIntent(db, { salonPath = '', intentId, now = Date.now(), FieldValue }) {
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);

  return db.runTransaction(async (tx) => {
    const intentRef = db.doc(p(`intents/${intentId}`));
    const intentSnap = await tx.get(intentRef);
    if (!intentSnap.exists) return { action: 'noop', reason: 'intent_missing' };

    const intent = { id: intentId, ...intentSnap.data() };

    // Read the marker first, and in the same transaction as the effect. Writing
    // it first as a claim means a crash between claim and work suppresses a real
    // intent for good; writing it in a separate batch is the same bug with a
    // wider window.
    if (intent.result != null) return { action: 'noop', reason: 'already_resolved' };

    const dayRef = db.doc(p(`days/${intent.date}`));
    const daySnap = await tx.get(dayRef);
    const day = daySnap.exists ? daySnap.data() : { version: 0, intervals: [] };

    let booking = null;
    if (intent.bookingId) {
      const bookingSnap = await tx.get(db.doc(p(`bookings/${intent.bookingId}`)));
      booking = bookingSnap.exists ? { id: intent.bookingId, ...bookingSnap.data() } : null;
    }

    // All reads are done. Firestore forbids reading after writing in a
    // transaction, so the decision happens on the boundary between the two.
    const verdict = decide({ intent, day, booking, now });

    if (verdict.action === 'apply') {
      tx.set(dayRef, applied(day, intent, now));
    }

    // Every outcome is recorded, including the refusals. A rejection she never
    // sees is indistinguishable from a booking that quietly vanished.
    tx.update(intentRef, {
      result: verdict.action,
      reason: verdict.reason,
      conflictWith: verdict.conflictWith ?? null,
      resolvedAt: FieldValue ? FieldValue.serverTimestamp() : now,
    });

    return verdict;
  });
}
