import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { classify, advances } from './payment.mjs';

/**
 * Handles one webhook event.
 *
 * Four rules do the work here, and each exists because of a specific way
 * deposits go missing:
 *
 *   1. RE-FETCH. The event payload is a snapshot from when the event was
 *      created, and events arrive out of order. State is computed from current
 *      truth, fetched now.
 *   2. THE MARKER IS READ FIRST, IN THE SAME TRANSACTION AS THE EFFECT. Writing
 *      it first as a claim means a crash between claim and work suppresses a
 *      real event for good. Writing it in a separate batch is the same bug with
 *      a wider window.
 *   3. MONOTONIC. A transition that would move back down the ladder is recorded
 *      and dropped, never applied.
 *   4. NOTHING HAPPENS AFTER THE RESPONSE. Function instances are frozen the
 *      instant they respond, so every side effect is an outbox row written
 *      inside this transaction — never a send.
 *
 * Losing the race to a concurrent delivery returns `duplicate`, and the caller
 * must answer HTTP 200. Returning 500 makes Stripe retry into the same race,
 * which amplifies into something that looks like an outage.
 */
export async function handleEvent(db, { event, fetchObject, now = Date.now(), salonPath = '' }) {
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);

  // Outside the transaction: the body re-runs on contention, and a retried body
  // that called Stripe again would double the API traffic and could observe two
  // different truths within one logical attempt.
  const object = await fetchObject(event);
  const bookingId = object?.bookingId ?? event.bookingId;

  return runTransaction(db, async (tx) => {
    const markerRef = doc(db, p(`processedEvents/${event.id}`));
    const marker = await tx.get(markerRef);
    if (marker.exists()) return { action: 'duplicate', reason: 'already_processed' };

    if (!bookingId) {
      tx.set(markerRef, { at: serverTimestamp(), type: event.type, outcome: 'ignored' });
      return { action: 'ignored', reason: 'not_an_iris_payment' };
    }

    const bookingRef = doc(db, p(`bookings/${bookingId}`));
    const snap = await tx.get(bookingRef);
    const booking = snap.exists() ? snap.data() : null;

    if (!booking) {
      // The payment exists and the booking does not. Recorded rather than
      // dropped: the reconciler repairs it, and a silent 200 would hide it.
      tx.set(markerRef, { at: serverTimestamp(), type: event.type, outcome: 'orphan' });
      tx.set(doc(db, p(`orphanPayments/${bookingId}`)), {
        bookingId, eventId: event.id, at: now, object,
      });
      return { action: 'orphan', reason: 'booking_missing' };
    }

    const from = booking.classification ?? 'pending';
    const verdict = classify(object, {
      expectedAmountMinor: booking.expectedAmountMinor,
      expectedCurrency: booking.currency ?? 'gbp',
    });

    // All reads done — Firestore forbids reading after writing in a transaction.
    if (!advances(from, verdict.to)) {
      tx.set(markerRef, {
        at: serverTimestamp(), type: event.type, outcome: 'superseded',
        wouldHaveBeen: verdict.to, kept: from,
      });
      return { action: 'dropped', reason: 'would_move_backwards', from, to: verdict.to };
    }

    tx.update(bookingRef, {
      classification: verdict.to,
      classificationReason: verdict.reason,
      updatedAt: now,
      lastEventId: event.id,
    });

    // Side effects as data, written here so they survive the function being
    // frozen the moment it responds.
    if (verdict.to === 'confirmed') {
      tx.set(doc(db, p(`outbox/confirm_client:${bookingId}`)), {
        kind: 'confirm_client', subjectId: bookingId, state: 'pending',
        attempts: 0, createdAt: now, nextAttemptAt: now, leaseUntil: 0,
      });
      tx.set(doc(db, p(`outbox/notify_stylist:${bookingId}`)), {
        kind: 'notify_stylist', subjectId: bookingId, state: 'pending',
        attempts: 0, createdAt: now, nextAttemptAt: now, leaseUntil: 0,
      });
    }

    tx.set(markerRef, {
      at: serverTimestamp(), type: event.type, outcome: 'applied',
      bookingId, from, to: verdict.to,
    });

    return { action: 'applied', reason: verdict.reason, from, to: verdict.to };
  });
}
