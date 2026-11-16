import { ALARMING } from './payment.mjs';

/**
 * Money that needs her, in one list.
 *
 * Disputes, refunds that failed or could not be sent, payments that did not
 * match, payments with no booking behind them: each was already recorded —
 * a classification on the booking, a dead row in the outbox, an orphan — and
 * none of it was ever shown to anyone. A dispute has a deadline, and a refund
 * that silently failed is a client who believes they were paid back.
 *
 * Data only. Names are not here, because the service does not know them: her
 * device puts the client's name to each item from her own diary.
 */

const json = (status, body) => ({ status, body });

/** What each alarming classification means, as an item kind. */
const KIND_OF = {
  reversed: 'disputed',
  refund_failed: 'refund_failed',
  held_for_review: 'held_for_review',
};

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export async function listAttention(db) {
  const [bookings, stuck, orphans] = await Promise.all([
    db.collection('bookings').where('classification', 'in', [...ALARMING]).get(),
    db.collection('outbox').where('state', 'in', ['dead', 'needs_reconcile']).get(),
    db.collection('orphanPayments').get(),
  ]);

  const items = [];

  for (const doc of bookings.docs) {
    const b = doc.data();
    // Dealt with — unless something new has happened since. Dismissing a
    // failed refund must not hide the dispute that follows it.
    if (b.attentionDismissedFor === b.classification) continue;
    items.push({
      id: `booking~${doc.id}`,
      kind: KIND_OF[b.classification],
      bookingId: doc.id,
      serviceName: b.serviceName ?? null,
      startsAt: iso(b.startsAt),
      amountMinor: b.expectedAmountMinor ?? null,
      at: b.updatedAt ?? b.createdAt ?? null,
      detail: b.classificationReason ?? null,
    });
  }

  // Only money. A message with no provider yet is not hers to chase.
  const stuckRefunds = stuck.docs.filter((d) => d.data().kind === 'refund_deposit' && !d.data().dismissedAt);
  const theirBookings = await Promise.all(
    stuckRefunds.map((d) => db.doc(`bookings/${d.data().subjectId}`).get()));
  for (const [i, doc] of stuckRefunds.entries()) {
    const row = doc.data();
    const b = theirBookings[i].data();
    items.push({
      id: `outbox~${doc.id}`,
      kind: 'refund_stuck',
      bookingId: row.subjectId,
      serviceName: b?.serviceName ?? null,
      startsAt: iso(b?.startsAt),
      amountMinor: row.amountMinor ?? null,
      at: row.deadAt ?? row.createdAt ?? null,
      detail: row.lastError ?? row.reason ?? null,
    });
  }

  for (const doc of orphans.docs) {
    const o = doc.data();
    if (o.dismissedAt) continue;
    items.push({
      id: `orphan~${doc.id}`,
      kind: 'payment_without_booking',
      bookingId: o.bookingId ?? doc.id,
      serviceName: null,
      startsAt: null,
      amountMinor: o.object?.amountMinor ?? null,
      at: o.at ?? null,
      detail: o.object?.paymentIntentId ?? null,
    });
  }

  items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return json(200, { items });
}

/** She has dealt with it — in Stripe, in person, or by refunding another way. */
export async function dismissAttention(db, itemId, now = Date.now()) {
  const [source, ...rest] = String(itemId ?? '').split('~');
  const docId = rest.join('~');
  const path = { booking: 'bookings', outbox: 'outbox', orphan: 'orphanPayments' }[source];
  if (!path || !docId || docId.includes('/')) return json(404, { error: 'no such item' });

  const ref = db.doc(`${path}/${docId}`);
  const snap = await ref.get();
  if (!snap.exists) return json(404, { error: 'no such item' });

  await ref.update(source === 'booking'
    ? { attentionDismissedFor: snap.data().classification ?? null, attentionDismissedAt: now }
    : { dismissedAt: now });
  return json(200, { ok: true });
}
