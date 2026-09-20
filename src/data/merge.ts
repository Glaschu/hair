import { Appointment, Client, ClientPhoto } from './types';

/**
 * Sync merge rules.
 *
 * Records are merged newest-wins by `updatedAt`, but a whole-record swap
 * loses field-level edits: add an Instagram handle on the phone, and any
 * later write of that same client from the iPad (which never saw the
 * handle) would erase it. So for the fields that only ever get *added* to
 * — contact details, formulas, notes, photos — a blank in the winning
 * record is filled from the older one instead of overwriting it.
 *
 * Trade-off: deliberately clearing one of these fields on one device can
 * be undone by the other device's older copy. Resurrecting a note is much
 * cheaper than silently losing one.
 */

// The app writes these as "empty" placeholders, so treat them as unset.
const PLACEHOLDERS = new Set(['none on file', 'not recorded']);

function isBlank(v: string | undefined | null): boolean {
  const t = (v ?? '').trim();
  return t === '' || PLACEHOLDERS.has(t.toLowerCase());
}

/** Winner's value, unless it's blank and the loser has something. */
function pickStr(win: string, lose: string): string {
  return isBlank(win) && !isBlank(lose) ? lose : win;
}

function pickOpt(win: string | undefined, lose: string | undefined): string | undefined {
  return isBlank(win) && !isBlank(lose) ? lose : win;
}

const time = (v?: number) => v ?? 0;

/** True when a tombstone supersedes this record (deleted after it was last edited). */
function isDeleted(id: string, updatedAt: number | undefined, tombstones?: Record<string, number>): boolean {
  const t = tombstones?.[id];
  return t !== undefined && t >= time(updatedAt);
}

/**
 * Generic newest-wins merge by id. Used for records whose fields are
 * numbers or enums, where filling blanks in would be wrong (a stock level
 * of 0 is a real value, not a gap).
 */
export function mergeById<T extends { id: string; updatedAt?: number }>(
  local: T[],
  remote: T[],
  tombstones?: Record<string, number>,
): T[] {
  return mergeWith(local, remote, tombstones, (win) => win);
}

/** Shared plumbing: newest-wins selection, with a hook to combine the pair. */
function mergeWith<T extends { id: string; updatedAt?: number }>(
  local: T[],
  remote: T[],
  tombstones: Record<string, number> | undefined,
  combine: (winner: T, loser: T) => T,
): T[] {
  const map = new Map<string, T>();

  for (const item of local) {
    if (isDeleted(item.id, item.updatedAt, tombstones)) continue;
    map.set(item.id, item);
  }

  for (const item of remote) {
    if (isDeleted(item.id, item.updatedAt, tombstones)) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }
    const remoteWins = time(item.updatedAt) > time(existing.updatedAt);
    const winner = remoteWins ? item : existing;
    const loser = remoteWins ? existing : item;
    map.set(item.id, combine(winner, loser));
  }

  return Array.from(map.values());
}

/** Photos from both copies, newest first, deduped by id (winner's copy kept). */
export function unionPhotos(win?: ClientPhoto[], lose?: ClientPhoto[]): ClientPhoto[] {
  const byId = new Map<string, ClientPhoto>();
  for (const p of lose ?? []) byId.set(p.id, p);
  for (const p of win ?? []) byId.set(p.id, p);
  return Array.from(byId.values()).sort((a, b) => {
    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    return Number.isNaN(diff) || diff === 0 ? a.id.localeCompare(b.id) : diff;
  });
}

/** Newest-wins, keeping contact details, formulas, notes and every photo. */
export function mergeClients(local: Client[], remote: Client[], tombstones?: Record<string, number>): Client[] {
  return mergeWith(local, remote, tombstones, (win, lose) => ({
    ...win,
    phone: pickStr(win.phone, lose.phone),
    email: pickStr(win.email, lose.email),
    instagram: pickOpt(win.instagram, lose.instagram),
    photo: pickOpt(win.photo, lose.photo),
    formula: pickStr(win.formula, lose.formula),
    allergies: pickStr(win.allergies, lose.allergies),
    notes: pickStr(win.notes, lose.notes),
    hair: {
      type: pickStr(win.hair.type, lose.hair.type),
      length: pickStr(win.hair.length, lose.hair.length),
      natural: pickStr(win.hair.natural, lose.hair.natural),
    },
    photos: unionPhotos(win.photos, lose.photos),
  }));
}

/** Newest-wins, keeping any visit-record text the other device already had. */
export function mergeAppointments(
  local: Appointment[],
  remote: Appointment[],
  tombstones?: Record<string, number>,
): Appointment[] {
  return mergeWith(local, remote, tombstones, (win, lose) => ({
    ...win,
    formula: pickOpt(win.formula, lose.formula),
    notes: pickOpt(win.notes, lose.notes),
    technique: pickOpt(win.technique, lose.technique),
    timing: pickOpt(win.timing, lose.timing),
    nextNotes: pickOpt(win.nextNotes, lose.nextNotes),
  }));
}
