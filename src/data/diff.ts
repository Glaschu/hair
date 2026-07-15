/**
 * Splits a state transition into the rows that need DB writes: `removed`
 * (in prev but not next) and `changed` (new items or replaced references).
 * Relies on state updates being immutable — an item mutated in place keeps
 * its reference and would be skipped.
 */
export function diffById<T extends { id: string }>(prev: T[], next: T[]) {
  const nextIds = new Set(next.map((n) => n.id));
  const prevById = new Map(prev.map((p) => [p.id, p]));
  return {
    removed: prev.filter((p) => !nextIds.has(p.id)),
    changed: next.filter((n) => prevById.get(n.id) !== n),
  };
}
