/**
 * Whether an hour on a link is free — the one answer, in one place.
 *
 * Three code paths ask this: a free booking, starting a deposit, and a paid
 * deposit confirming. They used to ask it three different ways, and the gap
 * between them was a double booking: `book()` ignored holds, so anyone could
 * take an hour another client was paying for, and a confirmed deposit never
 * marked its slot taken, so the hour went back on sale once the hold lapsed.
 *
 * A slot can be:
 *   free    — neither taken nor held
 *   held    — someone is in Stripe Checkout for it until `heldUntil`
 *   taken   — booked, by `takenBy`
 *
 * Holds lapse by being READ, never by a sweeper having run, so every function
 * here takes `now`.
 */

/** Held by a checkout other than `bookingId`, and the hold has not lapsed. */
export function heldByOther(slot, bookingId, now) {
  return (slot?.heldUntil ?? 0) > now && slot?.heldBy !== bookingId;
}

/** Taken by a booking other than `bookingId`. Unowned takes predate `takenBy` and count as someone else's. */
export function takenByOther(slot, bookingId) {
  return !!slot?.taken && slot?.takenBy !== bookingId;
}

/** Live holds on this link, other than one belonging to `bookingId`. */
export function liveHolds(link, now, bookingId = null) {
  return (link?.slots ?? []).filter((s) => !s.taken && heldByOther(s, bookingId, now)).length;
}

/**
 * How many more bookings this link can take, counting checkouts in progress.
 *
 * A one-use link with a client mid-checkout has no room for a second client,
 * even on a different hour — otherwise both pay and one of them is refunded.
 */
export function spaceLeft(link, now, bookingId = null) {
  return (link?.maxBookings ?? 1) - (link?.bookedCount ?? 0) - liveHolds(link, now, bookingId);
}

/**
 * Her days off, as stored on the salon record: [{ s, e }] in ms, end exclusive.
 * Anything malformed is ignored rather than trusted.
 */
export function daysOffOf(salon) {
  return (Array.isArray(salon?.daysOff) ? salon.daysOff : [])
    .filter((d) => Number.isFinite(d?.s) && Number.isFinite(d?.e) && d.s < d.e);
}

/** Does this slot touch one of her days off? */
export function onDayOff(slot, daysOff = []) {
  return daysOff.some((d) => slot.s < d.e && d.s < slot.e);
}

/**
 * Free for this booking to take, right now.
 *
 * @param daysOff  her blocked days. A day off refuses an hour everywhere —
 *                 viewing, booking, paying — including one freed by a client
 *                 cancelling, which would otherwise go straight back on offer.
 */
export function freeFor(link, slotId, now, bookingId = null, daysOff = []) {
  const slot = (link?.slots ?? []).find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'no_such_slot' };
  if (onDayOff(slot, daysOff)) return { ok: false, reason: 'day_off' };
  if (takenByOther(slot, bookingId)) return { ok: false, reason: 'taken' };
  if (heldByOther(slot, bookingId, now)) return { ok: false, reason: 'held' };
  if (spaceLeft(link, now, bookingId) <= 0) return { ok: false, reason: 'link_full' };
  return { ok: true, slot };
}
