import { EXPIRES_FLOOR_SECONDS } from './stripeShape.mjs';
import { freeFor, daysOffOf } from './slots.mjs';
import { isPlausibleEnvelope, isPlausibleRequestId } from './envelope.mjs';

/**
 * Taking a deposit.
 *
 * The piece that turns a booking link into money. It creates a Stripe Checkout
 * Session and puts the slot on hold — and the two are tied together on purpose:
 * the hold expires when the session does, so an abandoned checkout releases the
 * hour rather than blocking it until someone notices.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: confirm anything. The booking stays
 * `pending_payment` until the payment is confirmed from Stripe's side — by the
 * signed webhook, or by the return page asking the server to check. The browser
 * coming back from Stripe only navigates; it is not evidence, and treating it
 * as evidence is the single most common way a deposit gets taken with no
 * booking behind it.
 */

/**
 * How long the session, and so the hold, lasts.
 *
 * Stripe's floor is 30 minutes from the moment it CREATES the session, and it
 * refuses anything less. `now` is read before the database round trips and the
 * request to Stripe, so sitting exactly on the floor fails intermittently
 * whenever those cross a second boundary. Two minutes of margin removes that.
 */
export const HOLD_SECONDS = EXPIRES_FLOOR_SECONDS + 2 * 60;

/** A few minutes past the session, so a payment landing at the death still finds its hold. */
export const HOLD_GRACE_SECONDS = 10 * 60;

const json = (status, body) => ({ status, body });

/** Half, rounded to the penny, and never computed from anything the browser sent. */
export function depositMinor(priceMinor, percent = 50) {
  return Math.round((priceMinor * percent) / 100);
}

/** What a live checkout looks like to the page that started it. */
const resume = (b, id) => json(200, {
  bookingId: id,
  checkoutUrl: b.status === 'pending_payment' ? b.stripe?.url ?? null : null,
  cancelToken: b.cancelToken,
  status: b.status,
  depositMinor: b.expectedAmountMinor,
  holdExpiresAt: b.heldUntil,
});

/**
 * @param stripe  { createCheckoutSession, expireCheckoutSession } — injected,
 *                so this is testable without an account and without a network.
 */
export async function startDeposit(db, token, slotId, {
  stripe, now = Date.now(), origin, depositPercent = 50, newId,
  sealed, agreed, requestId,
} = {}) {
  if (!stripe) return json(501, { error: 'deposits not enabled on this service' });
  if (typeof slotId !== 'string' || !slotId) return json(400, { error: 'slotId required' });
  // The envelope is required BEFORE any money moves. A paid deposit attached to
  // a booking with no client details is an appointment she cannot ring, and the
  // details cannot be collected afterwards — the page that held them is gone.
  if (!sealed) return json(400, { error: 'sealed required' });
  if (typeof sealed === 'string' && sealed.length > 4096) return json(413, { error: 'too large' });
  if (!isPlausibleEnvelope(sealed)) return json(400, { error: 'not a sealed envelope' });
  if (!isPlausibleRequestId(requestId)) return json(400, { error: 'bad requestId' });

  // The same press arriving twice — a retry after a dropped response — must be
  // the same checkout, not a second one. Otherwise the second attempt finds the
  // first one's hold and tells the client their own time has been taken.
  //
  // Only a checkout still in play is resumed: one open at Stripe, or one
  // already paid (they are shown their booking). One they backed out of, that
  // expired, or that lost its hour is over — resuming it told a client who
  // backed out and tried again that their booking was "no longer active".
  if (requestId) {
    const prior = await db.collection('bookings')
      .where('token', '==', token).where('requestId', '==', requestId).limit(1).get();
    const found = prior.docs[0];
    if (found) {
      const b = found.data();
      const open = b.status === 'pending_payment' && (b.stripe?.expiresAt ?? 0) * 1000 > now;
      if (open || b.status === 'confirmed') return resume(b, found.id);
    }
  }

  const linkRef = db.doc(`links/${token}`);
  const [linkSnap, salonSnap] = await Promise.all([linkRef.get(), db.doc('salon/me').get()]);
  if (!salonSnap.exists) return json(404, { error: 'expired' });

  const link = linkSnap.exists ? linkSnap.data() : null;
  if (!link || link.revoked || link.expiresAt <= now
      || (link.bookedCount ?? 0) >= (link.maxBookings ?? 1)) {
    return json(404, { error: 'expired' });
  }

  // Held, taken, or the link already has as many checkouts in flight as it has
  // bookings to give. Whether a hold has lapsed is decided by reading its
  // expiry, never by a sweeper having run.
  const daysOff = daysOffOf(salonSnap.data());
  const free = freeFor(link, slotId, now, null, daysOff);
  if (!free.ok) {
    if (free.reason === 'no_such_slot') return json(404, { error: 'expired' });
    return json(409, { error: free.reason === 'day_off' ? 'day_off' : 'taken' });
  }

  // Already started: nobody pays a deposit for a time that has gone.
  if (free.slot.s <= now) return json(409, { error: 'taken' });

  // The server decides what was agreed, from the policy pinned to the link it
  // served. Checked here as well as in book(): this path also ends in a booking,
  // and it is the one that takes money.
  if (link.policyId && !agreed) {
    return json(422, {
      error: 'policy not agreed',
      detail: 'The cancellation policy has to be accepted before booking.',
    });
  }

  const amount = depositMinor(link.priceMinor, depositPercent);
  if (amount <= 0) return json(400, { error: 'nothing to take' });

  // Minted before anything is sent, so the session and the booking agree on
  // them from the first moment.
  const bookingId = newId ? newId() : db.collection('bookings').doc().id;
  const cancelToken = newId ? newId() : db.collection('bookings').doc().id;
  const expiresAtSec = Math.floor(now / 1000) + HOLD_SECONDS;

  // Created BEFORE the hold is written: if Stripe refuses, no chair-time has
  // been spent. The other order would leak holds on every failed attempt.
  let session;
  try {
    session = await stripe.createCheckoutSession({
      mode: 'payment',
      // Where the client lands after paying. It grants nothing: the page uses
      // the cancel token to ask the SERVER, which asks Stripe. The token is
      // also how they cancel later, exactly as on a free booking.
      success_url: `${origin}/b/${token}?paid=1&c=${cancelToken}`,
      // Backing out releases the hold at once (see routes.mjs /release), so
      // the times are there again when they land.
      cancel_url: `${origin}/b/${token}?back=1&c=${cancelToken}`,
      // Both, on purpose: a session carries client_reference_id and a
      // PaymentIntent does not, and refunds and disputes arrive as
      // PaymentIntent-shaped events.
      client_reference_id: bookingId,
      payment_intent_data: { metadata: { iris_booking_id: bookingId } },
      payment_method_types: ['card'],
      // Never left to default — Stripe's default is 24 hours, which would hold
      // a Saturday morning until Sunday.
      expires_at: expiresAtSec,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: amount,
          product_data: { name: `Deposit — ${link.serviceName}` },
        },
      }],
      idempotency_key: `deposit:${bookingId}`,
    });
  } catch (err) {
    return json(502, { error: 'could not start payment', detail: String(err?.message ?? err) });
  }

  const heldUntil = (expiresAtSec + HOLD_GRACE_SECONDS) * 1000;

  const outcome = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(linkRef);
    const current = fresh.data();
    // Revoked or expired while Stripe was answering: nothing to hold. Checked
    // again here, not just above — she can revoke a link at any moment.
    if (!current || current.revoked || current.expiresAt <= now) return { lost: true };
    const check = freeFor(current, slotId, now, null, daysOff);
    if (!check.ok) {
      // The same client, a moment ago, in a race with themselves: hand back
      // their checkout rather than telling them their own hold is someone
      // else's.
      const holder = check.slot ?? (current.slots ?? []).find((s) => s.id === slotId);
      if (requestId && holder?.heldBy) {
        const hb = await tx.get(db.doc(`bookings/${holder.heldBy}`));
        if (hb.exists && hb.data().requestId === requestId) return { replay: { id: hb.id, ...hb.data() } };
      }
      return { lost: true };
    }

    tx.update(linkRef, {
      slots: current.slots.map((s) => (s.id === slotId ? { ...s, heldUntil, heldBy: bookingId } : s)),
    });

    tx.set(db.doc(`bookings/${bookingId}`), {
      token, slotId, clientRef: current.clientRef,
      startsAt: check.slot.s, endsAt: check.slot.e,
      serviceName: current.serviceName, tz: current.tz ?? 'Europe/London',
      // Stored now, not at confirmation: the confirmation arrives long after
      // the page that held these details has closed.
      sealed,
      agreedAt: current.policyId ? now : null,
      agreedPolicyId: current.policyId ?? null,
      requestId: requestId ?? null,
      cancelToken,
      status: 'pending_payment',
      classification: 'pending',
      // Frozen here. Confirmation compares against this, never against the live
      // service price — which she may edit while a checkout is open.
      expectedAmountMinor: amount,
      currency: 'gbp',
      priceMinor: current.priceMinor,
      stripe: { sessionId: session.id, expiresAt: expiresAtSec, url: session.url ?? null },
      createdAt: now,
      heldUntil,
      seenAt: null,
      // See bookingApi.book: absent means she can never mark it seen.
      version: 0,
    });
    return { held: true };
  });

  if (!outcome.held) {
    // Nobody should be able to pay into this session: its hour is gone, or it
    // duplicates one already open. Expiring it is tidiness, not safety — if it
    // fails, a payment into it still arrives as an orphan that is refunded — so
    // a failure here must not turn a clean 409 into an error.
    await stripe.expireCheckoutSession?.(session.id).catch(() => {});
    if (outcome.replay) return resume(outcome.replay, outcome.replay.id);
    return json(409, { error: 'taken' });
  }

  return json(200, {
    bookingId,
    checkoutUrl: session.url,
    cancelToken,
    status: 'pending_payment',
    depositMinor: amount,
    holdExpiresAt: heldUntil,
  });
}

/**
 * Releases holds whose checkout was abandoned.
 *
 * A backstop, not the mechanism: every reader treats an elapsed `heldUntil` as
 * free already, so this only tidies. A sweeper that has not run must never be
 * able to block a booking.
 */
export async function releaseLapsedHolds(db, now = Date.now()) {
  const links = await db.collection('links').where('revoked', '==', false).get();
  let released = 0;

  for (const snap of links.docs) {
    const isLapsed = (s) => s.heldUntil && s.heldUntil <= now && !s.taken;
    if (!(snap.data().slots ?? []).some(isLapsed)) continue;

    // Re-read inside a transaction: writing back the array read above could
    // overwrite a booking that landed in between, putting a taken hour back on
    // offer.
    const did = await db.runTransaction(async (tx) => {
      const slots = (await tx.get(snap.ref)).data()?.slots ?? [];
      if (!slots.some(isLapsed)) return false;
      tx.update(snap.ref, { slots: slots.map((s) => (isLapsed(s) ? { ...s, heldUntil: null, heldBy: null } : s)) });
      return true;
    });
    if (did) released++;
  }
  return { released };
}
