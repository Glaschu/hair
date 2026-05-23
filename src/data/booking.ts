/** True when two time intervals overlap (touching end-to-start does not count). */
export function slotsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** True when [start, end) collides with any of the busy intervals. */
export function hasConflict(
  start: Date,
  end: Date,
  busy: { start: Date; end: Date }[],
): boolean {
  return busy.some((b) => slotsOverlap(start, end, b.start, b.end));
}
