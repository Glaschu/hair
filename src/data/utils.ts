import { Client, Schedule } from './types';

export const fmt = {
  time: (iso: string): string => {
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
  },
  timeShort: (iso: string): string => {
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return m === 0 ? `${h}${ap}` : `${h}:${m.toString().padStart(2, '0')}${ap}`;
  },
  day: (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  },
  monthYr: (d: Date): string =>
    d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  rel: (iso: string): string => {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ds = new Date(d);
    ds.setHours(0, 0, 0, 0);
    const diff = Math.round((ds.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },
  ago: (iso: string): string => {
    const d = new Date(iso);
    const today = new Date();
    const days = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    if (days < 365) return `${Math.round(days / 30)}mo ago`;
    return `${Math.round(days / 365)}y ago`;
  },
  currency: (amount: number, decimals = 0): string => {
    const fixed = Math.abs(amount).toFixed(decimals);
    const [int, dec] = fixed.split('.');
    const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec !== undefined ? `£${intFormatted}.${dec}` : `£${intFormatted}`;
  },
  duration: (mins: number): string => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  },
};

export function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
}

export function groupByLetter<T extends { name: string }>(items: T[]): { letter: string; data: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const letter = item.name[0].toUpperCase();
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(item);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, data]) => ({ letter, data }));
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function fmtHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${m.toString().padStart(2, '0')}${ap}`;
}

/** Builds a Client, filling sensible defaults for any fields not supplied. */
export function createClient(fields: Partial<Omit<Client, 'id'>> & { name: string }): Client {
  return {
    id: `c-${Date.now()}`,
    name: fields.name.trim(),
    phone: fields.phone ?? '',
    email: fields.email ?? '',
    instagram: fields.instagram,
    tone: fields.tone ?? '#C49A7A',
    photo: fields.photo,
    since: fields.since ?? new Date().getFullYear().toString(),
    hair: fields.hair ?? { type: 'Wavy', length: 'Mid-length', natural: 'Dark brown' },
    formula: fields.formula || 'Not recorded',
    allergies: fields.allergies || 'None on file',
    notes: fields.notes ?? '',
    vip: fields.vip ?? false,
  };
}

/** Whether a client matches a free-text search — name, email, or phone (digits-only). */
export function clientMatchesQuery(client: Client, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  return (
    client.name.toLowerCase().includes(q) ||
    client.email.toLowerCase().includes(q) ||
    (qDigits.length > 0 && client.phone.replace(/\D/g, '').includes(qDigits))
  );
}

export function numberFieldError(
  value: string,
  rule: { min?: number; positive?: boolean },
): string {
  if (!value.trim()) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Enter a valid number';
  if (rule.positive && n <= 0) return 'Must be more than 0';
  if (rule.min !== undefined && n < rule.min) return `Must be ${rule.min} or more`;
  return '';
}

/**
 * Bookable 30-minute start times for `date`, spanning that weekday's configured studio
 * hours (falling back to 8:00–19:00 when the day is marked closed). Past times are
 * dropped when `date` is today. `now` is injectable for deterministic tests.
 */
export function generateTimeSlots(
  schedule: Schedule,
  date: Date,
  now: Date = new Date(),
): { h: number; m: number }[] {
  const day = schedule[date.getDay()];
  let startMins = 8 * 60;
  let endMins = 19 * 60;
  if (day && day.open) {
    const [sh, sm] = day.start.split(':').map(Number);
    const [eh, em] = day.end.split(':').map(Number);
    startMins = sh * 60 + sm;
    endMins = eh * 60 + em;
  }
  const isToday = isSameDay(date, now);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const slots: { h: number; m: number }[] = [];
  for (let t = startMins; t <= endMins; t += 30) {
    if (isToday && t <= nowMins) continue;
    slots.push({ h: Math.floor(t / 60), m: t % 60 });
  }
  return slots;
}

export function checkSchedule(schedule: Schedule, date: Date, durationMins: number) {
  const day = schedule[date.getDay()];
  if (!day || !day.open) return { dayClosed: true, offHours: false, day };
  const [sh, sm] = day.start.split(':').map(Number);
  const [eh, em] = day.end.split(':').map(Number);
  const startMins = date.getHours() * 60 + date.getMinutes();
  const endMins = startMins + durationMins;
  const dayStart = sh * 60 + sm;
  const dayEnd = eh * 60 + em;
  const offHours = startMins < dayStart || endMins > dayEnd;
  return { dayClosed: false, offHours, day };
}
