import type { Appointment, Schedule } from './types';

/**
 * Days she has blocked off — a holiday, a course, a day she's ill.
 *
 * Her weekly hours say which days she USUALLY works; these are the exceptions.
 * Stored as ranges of local calendar dates, because that is how she thinks
 * about them ("20th to the 27th"), and turned into exact instants only when the
 * booking service needs them — so a holiday is the same days on the phone, the
 * iPad and the service, whatever the clocks did that week.
 */
export interface DayOff {
  id: string;
  /** First day off, local date, YYYY-MM-DD. */
  start: string;
  /** Last day off, inclusive. */
  end: string;
  note?: string;
  updatedAt?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar date as YYYY-MM-DD — never via toISOString, which is UTC and is yesterday after 11pm in summer. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of that date. */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const nextDay = (key: string) => {
  const d = fromKey(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
};
const prevDay = (key: string) => {
  const d = fromKey(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
};

/** The day off covering this date, if any. */
export function dayOffOn(daysOff: readonly DayOff[], date: Date): DayOff | null {
  const key = dateKey(date);
  return daysOff.find((d) => d.start <= key && key <= d.end) ?? null;
}

/**
 * Is she working that day? Her weekly hours first, then the exceptions — the
 * one question the calendars, Send link and the booking screens all ask.
 */
export function closedOn(
  schedule: Schedule,
  daysOff: readonly DayOff[],
  date: Date,
): { closed: boolean; reason: 'day-off' | 'weekly' | null; dayOff: DayOff | null } {
  const dayOff = dayOffOn(daysOff, date);
  if (dayOff) return { closed: true, reason: 'day-off', dayOff };
  const weekly = schedule[date.getDay()];
  if (weekly && !weekly.open) return { closed: true, reason: 'weekly', dayOff: null };
  return { closed: false, reason: null, dayOff: null };
}

/**
 * What the booking service needs: exact instants, local midnight to local
 * midnight, for days off that are not over yet. Past ones would only make it
 * check hours nobody can book.
 */
export function serviceRanges(daysOff: readonly DayOff[], now: Date = new Date()): { from: string; to: string }[] {
  const today = dateKey(now);
  return daysOff
    .filter((d) => d.end >= today)
    .map((d) => ({ from: fromKey(d.start).toISOString(), to: fromKey(nextDay(d.end)).toISOString() }));
}

/** Her days off from today on, soonest first. */
export function upcomingDaysOff(daysOff: readonly DayOff[], now: Date = new Date()): DayOff[] {
  const today = dateKey(now);
  return daysOff.filter((d) => d.end >= today).sort((a, b) => a.start.localeCompare(b.start));
}

/** A fresh id for a day off — unique enough across her devices, which merge by id. */
export const newDayOffId = () => `off_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Opens one day again. Part of a longer break is split around it, so opening
 * the middle Wednesday of a holiday keeps the days either side blocked.
 */
export function openDay(daysOff: readonly DayOff[], date: Date, newId: () => string, now = Date.now()): DayOff[] {
  const key = dateKey(date);
  const out: DayOff[] = [];
  for (const d of daysOff) {
    if (!(d.start <= key && key <= d.end)) { out.push(d); continue; }
    if (d.start < key) out.push({ ...d, end: prevDay(key), updatedAt: now });
    if (key < d.end) {
      // The first part keeps the original id; the second is a new day off.
      const id = d.start < key ? newId() : d.id;
      out.push({ ...d, id, start: nextDay(key), updatedAt: now });
    }
  }
  return out;
}

/** "Sat 20 Dec", "Sat 20 – Sat 27 Dec", "Wed 31 Dec – Fri 2 Jan". */
export function describeDayOff(d: Pick<DayOff, 'start' | 'end'>): string {
  const a = fromKey(d.start);
  const b = fromKey(d.end);
  const day = (x: Date) => x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  const month = (x: Date) => x.toLocaleDateString('en-GB', { month: 'short' });
  if (d.start === d.end) return `${day(a)} ${month(a)}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${day(a)} – ${day(b)} ${month(b)}`;
  return `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

/** Appointments still booked on days she has just blocked — hers to deal with, never cancelled for her. */
export function appointmentsOnDaysOff(
  appointments: readonly Appointment[],
  daysOff: readonly Pick<DayOff, 'start' | 'end'>[],
): Appointment[] {
  return appointments
    .filter((a) => a.status === 'upcoming')
    .filter((a) => {
      const key = dateKey(new Date(a.start));
      return daysOff.some((d) => d.start <= key && key <= d.end);
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
