import { createHash } from 'node:crypto';
import { overlaps } from './resolve.mjs';
import { depositMinor } from './deposit.mjs';
import { depositsEnabled } from './stripeClient.mjs';
import { freeFor, heldByOther, spaceLeft, liveHolds, daysOffOf, onDayOff } from './slots.mjs';
import { isPlausibleEnvelope, isPlausibleRequestId } from './envelope.mjs';

/**
 * The public booking API, on Firestore.
 *
 * The Firebase half of the two deployments. The Cloudflare Worker serves the
 * same four routes from D1; this one exists so a stylist who wants Firestore's
 * durability and real-time sync can run one stack instead of two.
 *
 * ONE STRUCTURAL IMPROVEMENT over the Worker, worth naming. There, claiming a
 * slot and writing the booking were two statements, so a process dying between
 * them burned the hour with no booking behind it. Here a link and its slots are
 * one document, so the claim, the count and the booking are a single
 * transaction — the hazard stops being something to remember and becomes
 * something the database will not let you do.
 *
 *   links/{token}   { clientRef, serviceName, durationMins, priceMinor, tz,
 *                     policyId, expiresAt, revoked, maxBookings, bookedCount,
 *                     slots: [{ id, s, e, taken }] }
 *   bookings/{id}   { token, slotId, clientRef, sealed, status, … }
 */

export const LINK_TTL_DAYS = 21;

const json = (status, body) => ({ status, body });

/** What this deployment can do, from what it has been given. */
export function capabilities(env = {}) {
  const caps = ['booking-links', 'offsite-backup', 'live-sync'];
  // The key AND the webhook secret. With the key alone the service can take
  // money but never learn it was paid, and that is worse than no deposits.
  if (depositsEnabled(env)) caps.push('deposits', 'refunds');
  return caps;
}

export function version(env) {
  return json(200, { service: 'iris-booking', api: 1, capabilities: capabilities(env) });
}

/** Live means: not revoked, not expired, and not already used up. */
function usable(link, now) {
  return !!link && !link.revoked
    && link.expiresAt > now
    && (link.bookedCount ?? 0) < (link.maxBookings ?? 1);
}

/**
 * What a client sees when they open their link.
 *
 * The salon must exist — after a reset there is no key to seal to, and offering
 * a form that produces an unopenable envelope is worse than saying nothing.
 */
export async function viewLink(db, token, now = Date.now(), env = {}) {
  const [linkSnap, salonSnap] = await Promise.all([
    db.doc(`links/${token}`).get(),
    db.doc('salon/me').get(),
  ]);
  if (!salonSnap.exists) return json(404, { error: 'expired' });

  const link = linkSnap.exists ? linkSnap.data() : null;
  if (!usable(link, now)) return json(404, { error: 'expired' });

  const salon = salonSnap.data();
  let policy = null;
  let refundTiers = null;
  if (link.policyId) {
    const p = await db.doc(`policies/${link.policyId}`).get();
    policy = p.exists ? p.data().text : null;
    // The numbers the refund is actually worked out from, shown beside her
    // words, so what a client agrees to and what they get back cannot differ.
    refundTiers = p.exists ? validTiers(p.data().tiers) ?? DEFAULT_TIERS : null;
  }

  return json(200, {
    salonName: salon.name,
    greeting: link.greeting ?? null,
    serviceName: link.serviceName,
    durationMins: link.durationMins,
    priceMinor: link.priceMinor,
    tz: link.tz ?? 'Europe/London',
    publicKey: salon.publicKey,
    policy,
    policyId: link.policyId ?? null,
    refundTiers,
    // Whether this deployment takes a deposit is a property of the deployment,
    // not of the software — the free Cloudflare version never does. The page
    // reads this rather than assuming, so one page serves both.
    depositMinor: depositsEnabled(env) ? depositMinor(link.priceMinor) : null,
    // A link whose every booking is spoken for by checkouts in progress has
    // nothing to offer until one of them pays or lapses.
    slots: (spaceLeft(link, now) > 0 ? (link.slots ?? []) : [])
      // A slot someone else is mid-checkout on is not on offer. Expiry is read
      // here rather than trusted to a sweeper.
      // Nor an hour on one of her days off — including one she blocked after
      // this link was sent.
      // Nor a time that has already started — a link lives three weeks, and
      // kept offering last Tuesday.
      .filter((s) => s.s > now && !s.taken && !heldByOther(s, null, now) && !onDayOff(s, daysOffOf(salon)))
      .sort((a, b) => a.s - b.s)
      .map((s) => ({ id: s.id, startsAt: new Date(s.s).toISOString(), endsAt: new Date(s.e).toISOString() })),
  });
}

/**
 * Takes a booking.
 *
 * Everything that must happen together happens in one transaction: the slot is
 * claimed, the link's count moves, and the booking is written. There is no
 * window in which one of those has happened and the others have not.
 */
export async function book(db, token, body, { now = Date.now(), newId, env = {} } = {}) {
  const { slotId, sealed, agreed, requestId } = body ?? {};
  if (typeof slotId !== 'string' || !slotId || !sealed) return json(400, { error: 'slotId and sealed required' });
  // An envelope is ~120 bytes of overhead plus the details; much larger is
  // someone using the store as free disk space.
  if (typeof sealed === 'string' && sealed.length > 4096) return json(413, { error: 'too large' });
  if (!isPlausibleEnvelope(sealed)) return json(400, { error: 'not a sealed envelope' });
  if (!isPlausibleRequestId(requestId)) return json(400, { error: 'bad requestId' });

  // Ids are generated BEFORE the transaction: the body re-runs on contention,
  // and a retried body would otherwise mint a different id each attempt.
  const id = newId ? newId() : db.collection('bookings').doc().id;
  const cancelToken = newId ? newId() : db.collection('bookings').doc().id;

  return db.runTransaction(async (tx) => {
    // A retry after a lost response must return the original booking, not send
    // them to a second slot — which, with a deposit attached, is two charges
    // for one person. Only a LIVE booking short-circuits: replaying a cancelled
    // one would tell someone they are booked when they are not.
    if (requestId) {
      const prior = await tx.get(
        db.collection('bookings').where('token', '==', token).where('requestId', '==', requestId).limit(1),
      );
      const found = prior.docs[0];
      if (found && found.data().status === 'confirmed') {
        return json(200, { ok: true, bookingId: found.id, cancelToken: found.data().cancelToken, replayed: true });
      }
    }

    const linkRef = db.doc(`links/${token}`);
    const [linkSnap, salonSnap] = await Promise.all([tx.get(linkRef), tx.get(db.doc('salon/me'))]);
    if (!salonSnap.exists) return json(404, { error: 'expired' });

    const link = linkSnap.exists ? linkSnap.data() : null;
    if (!usable(link, now)) return json(404, { error: 'expired' });

    // The server decides what was agreed, from the policy pinned to the link it
    // served. A boolean from the browser proves nothing — curl sends it too.
    if (link.policyId && !agreed) {
      return json(422, {
        error: 'policy not agreed',
        detail: 'The cancellation policy has to be accepted before booking.',
      });
    }

    // Where the deployment takes deposits, a free booking is a way round the
    // deposit — anyone can POST here directly. So it is refused, and the page
    // is sent down the deposit path instead.
    if (depositsEnabled(env) && depositMinor(link.priceMinor) > 0) {
      return json(402, { error: 'deposit required' });
    }

    const slots = link.slots ?? [];
    // Taken, or held by a client who is paying for it right now. Ignoring the
    // hold here let anyone take, for free, an hour someone else was paying for.
    const free = freeFor(link, slotId, now, id, daysOffOf(salonSnap.data()));
    if (!free.ok) {
      return free.reason === 'no_such_slot' ? json(404, { error: 'expired' }) : json(409, { error: 'taken' });
    }
    const slot = free.slot;
    // Already started: a page left open must not book the past.
    if (slot.s <= now) return json(409, { error: 'taken' });

    tx.update(linkRef, {
      bookedCount: (link.bookedCount ?? 0) + 1,
      slots: slots.map((s) => (s.id === slotId ? { ...s, taken: true, takenBy: id } : s)),
    });

    tx.set(db.doc(`bookings/${id}`), {
      token, slotId, clientRef: link.clientRef, sealed,
      startsAt: slot.s, endsAt: slot.e,
      serviceName: link.serviceName, priceMinor: link.priceMinor, tz: link.tz ?? 'Europe/London',
      status: 'confirmed',
      createdAt: now,
      agreedAt: link.policyId ? now : null,
      agreedPolicyId: link.policyId ?? null,
      requestId: requestId ?? null,
      cancelToken,
      seenAt: null,
      // Every booking is born versioned. The rules enforce compare-and-swap on
      // her edits as `version + 1`, and that expression ERRORS on a document
      // with no version — so a versionless booking is one she can never mark
      // seen, and it redelivers to her diary forever. Proven in rules.test.mjs.
      version: 0,
    });

    return json(200, { ok: true, bookingId: id, cancelToken });
  });
}

/** Her stated terms, as data. Percentages are OF THE DEPOSIT. */
export const DEFAULT_TIERS = [
  { minNoticeHours: 48, refundPct: 100 },
  { minNoticeHours: 24, refundPct: 50 },
  { minNoticeHours: 0, refundPct: 0 },
];

/**
 * Her refund schedule, as she set it — or null if it is not a schedule.
 *
 * Most notice first, each tier giving back no more than the one before, and
 * ending at zero hours so every cancellation lands somewhere. Anything else is
 * refused rather than repaired: a schedule the server reinterpreted is one a
 * client could argue they never agreed to.
 */
export function validTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 5) return null;
  let prev = null;
  for (const t of tiers) {
    if (!t || !Number.isFinite(t.minNoticeHours) || !Number.isInteger(t.refundPct)) return null;
    if (t.minNoticeHours < 0 || t.minNoticeHours > 24 * 90 || t.refundPct < 0 || t.refundPct > 100) return null;
    if (prev && (t.minNoticeHours >= prev.minNoticeHours || t.refundPct > prev.refundPct)) return null;
    prev = t;
  }
  if (prev.minNoticeHours !== 0) return null;
  return tiers.map(({ minNoticeHours, refundPct }) => ({ minNoticeHours, refundPct }));
}

export function tierFor(noticeMs, tiers = DEFAULT_TIERS) {
  const hours = noticeMs / 3_600_000;
  // Boundaries go the client's way: exactly 48 hours is the 48-hour tier.
  return (tiers.find((t) => hours >= t.minNoticeHours) ?? { refundPct: 0 }).refundPct;
}

/** What cancelling would cost, before anything is pressed. */
/** The schedule a booking was made under: the one pinned to its link, or the default. */
function pinnedTiers(policySnap) {
  // No policy was agreed: there are no terms to hold them to, so the deposit
  // comes back whenever they cancel. Applying the default schedule here kept
  // money under a 48-hour rule the client was never shown.
  if (!policySnap) return [{ minNoticeHours: 0, refundPct: 100 }];
  return (policySnap.exists ? validTiers(policySnap.data().tiers) : null) ?? DEFAULT_TIERS;
}

export async function previewCancel(db, cancelToken, now = Date.now()) {
  const [found, salonSnap] = await Promise.all([
    db.collection('bookings').where('cancelToken', '==', cancelToken).limit(1).get(),
    db.doc('salon/me').get(),
  ]);
  const snap = found.docs[0];
  if (!snap) return json(404, { error: 'no such booking' });

  const b = snap.data();
  const policySnap = b.agreedPolicyId ? await db.doc(`policies/${b.agreedPolicyId}`).get() : null;
  const noticeMs = Math.max(0, b.startsAt - now);
  return json(200, {
    status: b.status,
    // The page that shows this may be the return from Stripe, which cannot
    // rely on the link still being viewable — a used one-off link is gone.
    salonName: salonSnap.exists ? salonSnap.data().name : null,
    startsAt: new Date(b.startsAt).toISOString(),
    tz: b.tz, serviceName: b.serviceName,
    // Null on a free booking, so the page does not talk about a deposit that
    // was never taken.
    depositMinor: b.expectedAmountMinor ?? null,
    noticeMs,
    refundPct: b.status === 'confirmed' ? tierFor(noticeMs, pinnedTiers(policySnap)) : (b.refundPct ?? 0),
  });
}

/**
 * Cancels a booking: the one path, whoever is cancelling.
 *
 * The booking's status is the authority, never the slot. Freeing a slot is
 * exactly what lets a stale write reinstate a dead appointment, so a second
 * cancellation is a no-op rather than a second release.
 *
 * WHO CANCELS DECIDES WHAT COMES BACK.
 *   client — their link's schedule, at the notice they gave. The hour goes
 *            back on their link, so they can pick another, and the booking
 *            goes back into her inbox so her diary hears about it.
 *   salon  — the whole deposit, because she is the one calling it off. Unless
 *            she says the client asked, by text or in person: then their
 *            schedule, at the notice they gave HER — `cancelledAt`, since the
 *            request may arrive later from a phone that was offline.
 *            And the link is withdrawn once nothing is booked on it: she is
 *            taking the time back, not offering it again to the same person.
 */
async function cancelBooking(db, id, { by, now, refund = 'policy', cancelledAt = now }) {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`bookings/${id}`);
    const refundRef = db.doc(`outbox/refund_deposit:${id}`);
    const [snap, refundSnap] = await Promise.all([tx.get(ref), tx.get(refundRef)]);
    if (!snap.exists) return json(404, { error: 'no such booking' });
    const b = snap.data();

    // Still at Stripe. Saying "already cancelled" here — the old answer —
    // told someone their appointment was gone moments before it confirmed.
    if (b.status === 'pending_payment') {
      return json(409, { error: 'not confirmed yet', detail: 'The payment is still going through. Try again in a minute.' });
    }

    if (b.status !== 'confirmed') {
      return json(200, {
        ok: true, alreadyCancelled: true,
        noticeMs: b.noticeMs ?? 0, refundPct: b.refundPct ?? 0,
        refundMinor: Math.round(((b.expectedAmountMinor ?? 0) * (b.refundPct ?? 0)) / 100),
        startsAt: new Date(b.startsAt).toISOString(),
      });
    }

    const linkRef = db.doc(`links/${b.token}`);
    const [linkSnap, policySnap] = await Promise.all([
      tx.get(linkRef),
      b.agreedPolicyId ? tx.get(db.doc(`policies/${b.agreedPolicyId}`)) : null,
    ]);

    // When she cancels, notice runs to the moment she pressed cancel — never
    // before the booking existed, never later than now.
    const at = by === 'salon' ? Math.min(now, Math.max(b.createdAt ?? 0, cancelledAt)) : now;
    const noticeMs = Math.max(0, b.startsAt - at);
    const refundPct = by === 'salon' && refund === 'full' ? 100 : tierFor(noticeMs, pinnedTiers(policySnap));

    tx.update(ref, {
      status: 'cancelled', cancelledAt: at, cancelledBy: by, noticeMs, refundPct,
      // Back into her inbox, so her diary hears about it on the next pull. A
      // cancellation she never learns of is a no-show she waits for, in an
      // hour she could have resold. Her own cancellations she already knows.
      ...(by === 'client' ? { seenAt: null } : {}),
    });

    if (linkSnap.exists) {
      const link = linkSnap.data();
      const bookedCount = Math.max(0, (link.bookedCount ?? 1) - 1);
      const slots = (link.slots ?? []).map((s) => (s.id === b.slotId ? { ...s, taken: false, takenBy: null } : s));
      tx.update(linkRef, {
        bookedCount,
        slots,
        // Withdrawn when she cancels and nothing else is booked or being paid
        // for on it: otherwise the same client could book straight back into
        // the hour she has just called off. A revoked link also stops blocking
        // its hours, so she can offer them to someone else.
        ...(by === 'salon' && bookedCount === 0 && liveHolds({ ...link, slots }, now) === 0
          ? { revoked: true } : {}),
      });
    }

    const queue = (kind, extra = {}) => tx.set(db.doc(`outbox/${kind}:${id}`), {
      kind, subjectId: id, state: 'pending',
      attempts: 0, createdAt: now, nextAttemptAt: now, leaseUntil: 0, ...extra,
    });

    // What was promised is what happens: the refund is queued in the same
    // transaction as the cancellation, so one cannot happen without the other.
    // Only while the money is actually held — a deposit already refunded or
    // disputed is not refunded again — and never over a refund row that
    // already exists.
    const refundMinor = Math.round(((b.expectedAmountMinor ?? 0) * refundPct) / 100);
    const refunding = refundMinor > 0 && b.classification === 'confirmed' && !refundSnap.exists;
    if (refunding) {
      queue('refund_deposit', {
        amountMinor: refundMinor,
        paymentIntentId: b.stripe?.paymentIntentId ?? null,
        reason: by === 'salon' ? `cancelled_by_salon_${refund}` : 'cancelled',
      });
    }
    queue('cancel_notice', { by });

    return json(200, {
      ok: true, alreadyCancelled: false, noticeMs, refundPct,
      refundMinor: refunding ? refundMinor : 0,
      startsAt: new Date(b.startsAt).toISOString(),
    });
  });
}

/** A client cancelling from their link. */
export async function cancel(db, cancelToken, by = 'client', now = Date.now()) {
  const found = await db.collection('bookings')
    .where('cancelToken', '==', cancelToken).limit(1).get();
  const first = found.docs[0];
  if (!first) return json(404, { error: 'no such booking' });
  return cancelBooking(db, first.id, { by, now });
}

/**
 * Her cancelling a web booking from her diary.
 *
 * Before this the service was never told: the hour stayed taken on her booking
 * page, and a deposit was never refunded.
 *
 * @param refund  'full' — she is calling it off; 'policy' — the client asked.
 */
export async function cancelBySalon(db, bookingId, { refund, cancelledAt, now = Date.now() } = {}) {
  if (refund !== 'full' && refund !== 'policy') return json(400, { error: "refund must be 'full' or 'policy'" });
  if (cancelledAt != null && !Number.isFinite(cancelledAt)) return json(400, { error: 'cancelledAt must be a time' });
  return cancelBooking(db, bookingId, { by: 'salon', now, refund, cancelledAt: cancelledAt ?? now });
}

/**
 * What cancelling would mean, before she chooses — so the choice she is asked
 * to make shows real amounts, not percentages.
 */
export async function previewSalonCancel(db, bookingId, now = Date.now()) {
  const snap = await db.doc(`bookings/${bookingId}`).get();
  if (!snap.exists) return json(404, { error: 'no such booking' });
  const b = snap.data();
  const policySnap = b.agreedPolicyId ? await db.doc(`policies/${b.agreedPolicyId}`).get() : null;
  const noticeMs = Math.max(0, b.startsAt - now);
  // The deposit is only "held" while the money is actually there — not
  // refunded, not disputed, not still at Stripe.
  const held = b.status === 'confirmed' && b.classification === 'confirmed' ? b.expectedAmountMinor ?? 0 : 0;
  return json(200, {
    status: b.status,
    depositMinor: held,
    noticeMs,
    policyRefundPct: tierFor(noticeMs, pinnedTiers(policySnap)),
  });
}

/**
 * Mints a link.
 *
 * Two links must never offer the same hour: the app checks her calendar when
 * she makes one, but it cannot see the other links she has out, so without this
 * two clients can both book the same Saturday.
 */
export async function createLink(db, body, { now = Date.now(), newId } = {}) {
  const { clientRef, serviceName, slots, greeting, durationMins, priceMinor, tz, maxBookings } = body ?? {};
  if (typeof clientRef !== 'string' || typeof serviceName !== 'string' || !Array.isArray(slots) || !slots.length) {
    return json(400, { error: 'clientRef, serviceName and at least one slot required' });
  }
  // Shown to clients and stored for weeks: kept to sizes that are plainly
  // a reference, a service and a greeting.
  if (clientRef.length > 512 || serviceName.length > 120 || (greeting != null && String(greeting).length > 80)
      || slots.length > 50) {
    return json(413, { error: 'too large' });
  }
  if ((priceMinor != null && !Number.isFinite(priceMinor)) || (durationMins != null && !Number.isFinite(durationMins))) {
    return json(400, { error: 'priceMinor and durationMins must be numbers' });
  }

  const wanted = slots.map((s) => ({ s: Date.parse(s.startsAt), e: Date.parse(s.endsAt) }));
  if (wanted.some((i) => !Number.isFinite(i.s) || !Number.isFinite(i.e) || i.e <= i.s)) {
    return json(400, { error: 'each slot needs startsAt before endsAt' });
  }

  // One link is made at a time. The clash check and the write used to be
  // separate steps, so her phone and iPad sending links in the same second
  // could both offer Saturday at 10 — and a query alone cannot lock out a
  // document that does not exist yet. Every create reads and writes this one
  // lock document, so the database runs them one after another.
  const lockRef = db.doc('locks/links');
  return db.runTransaction(async (tx) => {
    await tx.get(lockRef);
    const salon = await tx.get(db.doc('salon/me'));
    const offDay = wanted.find((w) => onDayOff(w, daysOffOf(salon.data())));
    if (offDay) {
      // The app already skips her days off; the service is where it has to be true.
      return json(409, {
        error: 'day off',
        detail: 'That time is on one of your days off.',
        startsAt: new Date(offDay.s).toISOString(),
      });
    }

    const live = await tx.get(db.collection('links')
      .where('revoked', '==', false).where('expiresAt', '>', now));

    for (const snap of live.docs) {
      const other = snap.data();
      // A link that has taken all its bookings offers nothing any more. Counting
      // its untaken hours kept them off sale for every other client until it
      // expired — three weeks — after one of them was booked.
      const spent = (other.bookedCount ?? 0) >= (other.maxBookings ?? 1);
      for (const existing of other.slots ?? []) {
        if (spent && !existing.taken) continue;
        const clash = wanted.find((w) => overlaps(w, existing));
        if (clash) {
          return json(409, {
            error: 'slot already offered',
            detail: 'Another link is already offering that time. Revoke it first, or pick another.',
            startsAt: new Date(clash.s).toISOString(),
          });
        }
      }
    }

    // The terms in force NOW are pinned to the link, words and numbers together,
    // so a client agrees to exactly what they were shown even if she edits her
    // policy tomorrow. Chosen by the server from her salon record — never taken
    // from the request.
    const policyText = salon.exists ? salon.data().policy ?? null : null;
    let policyId = null;
    if (policyText) {
      // Words and numbers pinned together, and named by both: change either and
      // it is a different policy, so a link already sent keeps the terms its
      // client was shown.
      const tiers = validTiers(salon.data().tiers) ?? DEFAULT_TIERS;
      policyId = createHash('sha256').update(`${policyText}\n${JSON.stringify(tiers)}`).digest('hex').slice(0, 24);
      tx.set(db.doc(`policies/${policyId}`),
        { text: policyText, tiers, createdAt: now },
        { merge: true },
      );
    }

    const token = newId ? newId() : db.collection('links').doc().id;
    tx.set(lockRef, { at: now });
    tx.set(db.doc(`links/${token}`), {
      clientRef, serviceName,
      greeting: greeting ?? null,
      durationMins: durationMins ?? 60,
      priceMinor: Math.round(priceMinor ?? 0),
      tz: tz ?? 'Europe/London',
      policyId,
      createdAt: now,
      expiresAt: now + LINK_TTL_DAYS * 86_400_000,
      revoked: false,
      maxBookings: Math.max(1, Math.round(maxBookings ?? 1)),
      bookedCount: 0,
      slots: wanted.map((i, n) => ({ id: `s${n}`, s: i.s, e: i.e, taken: false })),
    });

    return json(200, { token, expiresAt: now + LINK_TTL_DAYS * 86_400_000 });
  });
}

/**
 * Her salon record: the name clients see and the key their details are sealed
 * to. Null until a first device has set it up.
 */
export async function getSalon(db) {
  const snap = await db.doc('salon/me').get();
  if (!snap.exists) return json(404, { error: 'not set up' });
  const { name, publicKey, policy, tiers } = snap.data();
  return json(200, { name, publicKey, policy: policy ?? null, tiers: validTiers(tiers) ?? null });
}

/** How recently she must have typed her password to re-key the salon. */
export const REKEY_WINDOW_SECONDS = 10 * 60;

/**
 * Sets up, or updates, her salon record.
 *
 * The key is write-once, for the same reason as on the Cloudflare version:
 * changing it sends every future booking to whoever changed it. There, a second
 * secret gates it. Here the equivalent is a FRESH sign-in — a stolen ID token
 * is short-lived, but it is not enough on its own to redirect her bookings.
 *
 * @param signedInAt  seconds since the epoch, from the verified token's auth_time
 */
export async function putSalon(db, body, { now = Date.now(), signedInAt = 0, confirmReset = false } = {}) {
  const { name, publicKey, policy, tiers } = body ?? {};
  if (typeof name !== 'string' || !name || typeof publicKey !== 'string' || !publicKey) {
    return json(400, { error: 'name and publicKey required' });
  }
  if (policy !== undefined && policy !== null && typeof policy !== 'string') {
    return json(400, { error: 'policy must be text' });
  }
  const schedule = tiers === undefined ? undefined : validTiers(tiers);
  if (tiers !== undefined && !schedule) {
    return json(400, {
      error: 'not a refund schedule',
      detail: 'Most notice first, never giving back more for less notice, ending at 0 hours.',
    });
  }
  // Her terms, not a client's words: capped so the page stays a page.
  if (name.length > 120 || (policy && policy.length > 2000)) return json(413, { error: 'too long' });

  const ref = db.doc('salon/me');
  const current = await ref.get();
  if (current.exists && current.data().publicKey !== publicKey) {
    const fresh = now / 1000 - signedInAt < REKEY_WINDOW_SECONDS;
    if (!confirmReset || !fresh) {
      return json(409, {
        error: 'already set up',
        detail: 'This service already has a salon. Starting over needs a fresh sign-in.',
      });
    }
  }

  await ref.set({
    name,
    publicKey,
    // Absent means "leave it", so a re-link or reinstall never silently reverts
    // terms she has edited — the terms a chargeback turns on.
    ...(policy === undefined ? {} : { policy }),
    ...(schedule === undefined ? {} : { tiers: schedule }),
    updatedAt: now,
  }, { merge: true });
  return json(200, { ok: true });
}

/** Stops a link being used. Bookings already made on it stand. */
export async function revokeLink(db, token) {
  const ref = db.doc(`links/${token}`);
  const snap = await ref.get();
  if (snap.exists) await ref.update({ revoked: true });
  return json(200, { ok: true });
}

/**
 * Her days off, replacing whatever was there.
 *
 * Kept on the service rather than applied once to the links already out, so a
 * day off refuses an hour on every path, every time — and opening the day again
 * puts those hours straight back, because nothing was thrown away.
 *
 * @param ranges  [{ from, to }] as ISO instants, `to` exclusive.
 */
export async function putDaysOff(db, ranges, { now = Date.now() } = {}) {
  if (!Array.isArray(ranges) || ranges.length > 200) return json(400, { error: 'ranges required' });
  const spans = ranges.map((r) => ({ s: Date.parse(r?.from), e: Date.parse(r?.to) }));
  if (spans.some((x) => !Number.isFinite(x.s) || !Number.isFinite(x.e) || x.e <= x.s)) {
    return json(400, { error: 'each range needs from before to' });
  }
  const ref = db.doc('salon/me');
  if (!(await ref.get()).exists) return json(404, { error: 'not set up' });
  await ref.update({ daysOff: spans, daysOffUpdatedAt: now });
  return json(200, { ok: true, count: spans.length });
}
