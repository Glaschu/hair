/**
 * The resolver's decision, as a pure function.
 *
 * Her devices never write occupancy. They write *intents* — proposals — and
 * this decides what happens to each one. It is the only thing standing between
 * a queued offline write and the calendar, and it runs with admin privileges,
 * so no security rule constrains it. That makes it server code that must be
 * tested rather than a rule that is enforced.
 *
 * Kept pure and separate from the transaction on purpose: the decision is where
 * every interesting case lives, and it can be exercised exhaustively in
 * milliseconds without a database.
 */

/** Six hours. A write from a device dark longer than this describes a world that has moved on. */
export const MAX_ELAPSED_MS = 6 * 60 * 60 * 1000;

/** How far behind the day document a device may be before we stop trusting its view. */
export const MAX_VERSION_DRIFT = 25;

/** Statuses a booking can hold and still be acted on. */
const LIVE = new Set(['confirmed', 'pending_payment']);

/**
 * Intervals that actually occupy the chair right now.
 *
 * Expiry is evaluated HERE, at read time, not left to the sweeper. A hold whose
 * TTL has passed is free whether or not the ten-minute sweep has run — so a
 * sweeper outage can never block bookings, and Firestore's TTL (which deletes
 * "typically within 24 hours", leaving expired documents readable meanwhile)
 * is never load-bearing for a thirty-minute hold.
 */
export function liveIntervals(day, now) {
  return (day?.intervals ?? []).filter(
    (i) => i.kind !== 'hold' || !i.expiresAt || i.expiresAt > now,
  );
}

/** Half-open overlap: [s, e). Touching end-to-start is not a clash. */
export function overlaps(a, b) {
  return a.s < b.e && b.s < a.e;
}

/**
 * How long an intent spent in the queue, in a form a wrong device clock cannot
 * inflate or hide.
 *
 * `clientMadeAt` comes from the device and is advisory only. If it claims to be
 * from the future, the elapsed time is meaningless, so we return null and let
 * the caller fall back to version drift — which is set from data the device
 * read from the server and therefore cannot forge forwards.
 */
export function elapsedMs(intent) {
  const made = intent.clientMadeAt;
  const landed = intent.serverReceivedAt;
  if (typeof made !== 'number' || typeof landed !== 'number') return null;
  const delta = landed - made;
  return delta < 0 ? null : delta;
}

/**
 * @returns {{action: 'noop'|'apply'|'reject'|'review', reason: string, conflictWith?: string}}
 */
export function decide({ intent, day, booking, now, limits = {} }) {
  const maxElapsed = limits.maxElapsedMs ?? MAX_ELAPSED_MS;
  const maxDrift = limits.maxVersionDrift ?? MAX_VERSION_DRIFT;

  // 1. Idempotence. The resolver is a Firestore trigger and triggers are
  //    at-least-once, so the same intent arrives more than once as a matter of
  //    course. A resolved intent is never re-decided.
  if (intent.result != null) return { action: 'noop', reason: 'already_resolved' };

  const target = intent.target;
  if (!target || !(target.e > target.s)) {
    return { action: 'reject', reason: 'malformed_target' };
  }

  // 2. Is the booking this intent is about still alive?
  //
  //    THIS RUNS FIRST, before the conflict check, and it is the test whose
  //    absence broke the claim that a replayed offline write cannot resurrect a
  //    cancelled booking. The sequence: her iPad nudges an appointment while
  //    offline; the client cancels and is refunded, so the interval is removed;
  //    the iPad reconnects. Conflict passes — the hour is free *because* it was
  //    cancelled — staleness passes, the time is still in the future. Without
  //    this check the refunded appointment walks straight back into her
  //    calendar and back into occupancy.
  if (intent.bookingId) {
    if (!booking) return { action: 'reject', reason: 'booking_missing' };
    if (!LIVE.has(booking.status)) {
      return { action: 'reject', reason: `booking_${booking.status}` };
    }
  }

  // 3. A proposal about a time that has already passed is not a proposal.
  //    Review rather than reject: she may be recording something that happened,
  //    and silently dropping it would lose work.
  if (target.e <= now) return { action: 'review', reason: 'target_in_past' };

  // 4. Does it clash with something that is actually there?
  const clash = liveIntervals(day, now).find(
    (i) => i.id !== intent.bookingId && overlaps(target, i),
  );
  if (clash) return { action: 'reject', reason: 'conflict', conflictWith: clash.id };

  // 5. Staleness, even with no conflict. A device that has been dark for days
  //    is describing a world that no longer exists, and applying that silently
  //    is how an appointment nobody remembers making appears in the diary.
  const elapsed = elapsedMs(intent);
  const drift = typeof intent.basisVersion === 'number' && typeof day?.version === 'number'
    ? day.version - intent.basisVersion
    : 0;

  if (elapsed === null) {
    // The device clock is ahead of the server, so elapsed time tells us nothing.
    // Version drift is the fallback because it cannot be forged.
    if (drift > maxDrift) return { action: 'review', reason: 'stale_version_skewed_clock' };
  } else if (elapsed > maxElapsed) {
    return { action: 'review', reason: 'stale_elapsed' };
  } else if (drift > maxDrift) {
    return { action: 'review', reason: 'stale_version' };
  }

  return { action: 'apply', reason: 'ok' };
}

/**
 * The day document as it should look after an intent is applied.
 *
 * Returns a new object rather than mutating, so a Firestore transaction — whose
 * body re-runs on contention — can call it repeatedly without accumulating
 * edits from an attempt that was thrown away.
 */
export function applied(day, intent, now) {
  const base = liveIntervals(day, now).filter((i) => i.id !== intent.bookingId);
  const next = intent.op === 'cancel'
    ? base
    : [...base, {
        id: intent.bookingId ?? intent.id,
        s: intent.target.s,
        e: intent.target.e,
        kind: 'appointment',
        origin: intent.origin ?? 'manual',
      }];

  return {
    ...day,
    version: (day?.version ?? 0) + 1,
    intervals: next.sort((a, b) => a.s - b.s),
  };
}
