import { classify, advances } from './payment.mjs';
import { freeFor, daysOffOf } from './slots.mjs';

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
export async function handleEvent(db, { event, fetchObject, now = Date.now(), salonPath = '', FieldValue }) {
  const stamp = () => (FieldValue ? FieldValue.serverTimestamp() : now);
  const p = (rest) => (salonPath ? `${salonPath}/${rest}` : rest);

  // Outside the transaction: the body re-runs on contention, and a retried body
  // that called Stripe again would double the API traffic and could observe two
  // different truths within one logical attempt.
  const object = await fetchObject(event);
  const bookingId = object?.bookingId ?? event.bookingId;

  return db.runTransaction(async (tx) => {
    const markerRef = db.doc(p(`processedEvents/${event.id}`));
    const marker = await tx.get(markerRef);
    if (marker.exists) return { action: 'duplicate', reason: 'already_processed' };

    if (!bookingId) {
      tx.set(markerRef, { at: stamp(), type: event.type, outcome: 'ignored' });
      return { action: 'ignored', reason: 'not_an_iris_payment' };
    }

    const bookingRef = db.doc(p(`bookings/${bookingId}`));
    const snap = await tx.get(bookingRef);
    const booking = snap.exists ? snap.data() : null;

    if (!booking) {
      // The payment exists and the booking does not. Recorded rather than
      // dropped: a silent 200 would hide it, and this is money with nothing
      // behind it.
      tx.set(markerRef, { at: stamp(), type: event.type, outcome: 'orphan' });
      tx.set(db.doc(p(`orphanPayments/${bookingId}`)), {
        bookingId, eventId: event.id, at: now, object,
      });
      return { action: 'orphan', reason: 'booking_missing' };
    }

    const from = booking.classification ?? 'pending';
    let verdict = classify(object, {
      expectedAmountMinor: booking.expectedAmountMinor,
      expectedCurrency: booking.currency ?? 'gbp',
    });

    // A session that expired unpaid can never be paid now. Closing it, rather
    // than leaving it `pending` for ever, is what stops the liveness sweep
    // reporting every abandoned checkout as money gone missing.
    if (event.type === 'checkout.session.expired' && verdict.to === 'pending' && from === 'pending') {
      verdict = { to: 'closed', reason: 'checkout_expired' };
    }

    // Everything the effects below might need is read now: Firestore forbids
    // reading after writing in a transaction.
    const moneyArrived = verdict.to === 'confirmed' && advances(from, verdict.to);
    const takesSlot = moneyArrived && booking.status === 'pending_payment';
    // An unpaid checkout that has ended: the booking is over, and its hold on
    // the hour goes with it — now, not when the hold would have lapsed.
    const closing = verdict.to === 'closed' && booking.status === 'pending_payment';
    const linkRef = (takesSlot || closing) && booking.token ? db.doc(p(`links/${booking.token}`)) : null;
    const link = linkRef ? await tx.get(linkRef).then((l) => (l.exists ? l.data() : null)) : null;
    // Her days off, for a slot about to be taken: a day she blocked while
    // they were paying is refunded, not booked.
    const daysOff = takesSlot ? daysOffOf((await tx.get(db.doc(p('salon/me')))).data()) : [];
    const refundRef = db.doc(p(`outbox/refund_deposit:${bookingId}`));
    const refundQueued = moneyArrived ? (await tx.get(refundRef)).exists : true;

    if (!advances(from, verdict.to)) {
      tx.set(markerRef, {
        at: stamp(), type: event.type, outcome: 'superseded',
        wouldHaveBeen: verdict.to, kept: from,
      });
      return { action: 'dropped', reason: 'would_move_backwards', from, to: verdict.to };
    }

    /**
     * The classification is what the MONEY did. `status` is what the BOOKING
     * is, and her device reads that one — the inbox asks for
     * `status == 'confirmed'`. Moving one without the other is how a paid
     * deposit becomes an appointment that never arrives.
     */
    const update = {
      classification: verdict.to,
      classificationReason: verdict.reason,
      updatedAt: now,
      lastEventId: event.id,
      ...(object?.paymentIntentId ? { 'stripe.paymentIntentId': object.paymentIntentId } : {}),
    };

    const queue = (kind, extra = {}) => tx.set(db.doc(p(`outbox/${kind}:${bookingId}`)), {
      kind, subjectId: bookingId, state: 'pending',
      attempts: 0, createdAt: now, nextAttemptAt: now, leaseUntil: 0, ...extra,
    });

    // Money that has nowhere to go goes back. Never overwritten if it already
    // exists: a refund row reset to pending is a second refund.
    const refundAll = (reason) => {
      if (refundQueued) return;
      queue('refund_deposit', {
        amountMinor: object?.amountMinor ?? booking.expectedAmountMinor,
        paymentIntentId: object?.paymentIntentId ?? null,
        reason,
      });
    };

    let outcome = verdict.to;

    if (takesSlot) {
      // The hold may have lapsed while they were paying, and the hour gone to
      // someone else. Taking it anyway is a double booking; so is confirming
      // without taking it, because the hour goes back on sale when the hold
      // lapses. So the slot is taken HERE, in the same transaction as the
      // confirmation — or the money goes back.
      const free = link && !link.revoked ? freeFor(link, booking.slotId, now, bookingId, daysOff) : { ok: false };

      if (free.ok) {
        update.status = 'confirmed';
        update.confirmedAt = now;
        tx.update(linkRef, {
          bookedCount: (link.bookedCount ?? 0) + 1,
          slots: link.slots.map((s) => (s.id === booking.slotId
            ? { ...s, taken: true, takenBy: bookingId, heldUntil: null, heldBy: null }
            : s)),
        });
        queue('confirm_client');
        queue('notify_stylist');
        outcome = 'confirmed';
      } else {
        update.status = 'slot_lost';
        // Our own lapsed hold, if it is still marked, is released: the hour is
        // not ours to keep blocked.
        if (link) {
          tx.update(linkRef, {
            slots: link.slots.map((s) => (s.id === booking.slotId && s.heldBy === bookingId
              ? { ...s, heldUntil: null, heldBy: null }
              : s)),
          });
        }
        refundAll('slot_lost');
        queue('notify_stylist', { about: 'slot_lost' });
        outcome = 'slot_lost';
      }
    } else if (closing) {
      update.status = 'expired';
      if (link) {
        tx.update(linkRef, {
          slots: link.slots.map((s) => (s.id === booking.slotId && s.heldBy === bookingId
            ? { ...s, heldUntil: null, heldBy: null }
            : s)),
        });
      }
      outcome = 'expired';
    } else if (moneyArrived) {
      // Paid for a booking that is not waiting for payment — already cancelled,
      // expired, or lost. No "you're booked" message for an appointment that
      // does not exist, and the money goes back.
      refundAll(`paid_while_${booking.status ?? 'unknown'}`);
      queue('notify_stylist', { about: 'refund_after_late_payment' });
      outcome = 'refunded_late_payment';
    }

    tx.update(bookingRef, update);

    tx.set(markerRef, {
      at: stamp(), type: event.type, outcome: 'applied',
      bookingId, from, to: verdict.to, result: outcome,
    });

    return { action: 'applied', reason: verdict.reason, from, to: verdict.to, result: outcome };
  });
}
