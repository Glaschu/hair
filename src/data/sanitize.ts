import { ExportPayload, Client, Product, Appointment, Service, ClientPhoto, Schedule, AppointmentStatus } from './types';

// Data that crosses the app boundary — file imports, iCloud sync, restored backups —
// can be hand-edited, truncated, or written by a future/past app version. Everything
// here coerces rather than trusts, so malformed records get dropped or repaired
// instead of crashing a screen that assumes `name[0]` or `products.map` exists.

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const validDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());

const STATUSES: AppointmentStatus[] = ['upcoming', 'completed', 'cancelled', 'no-show'];

function sanitizeClient(c: any): Client | null {
  if (!c || typeof c !== 'object' || !c.id) return null;
  const name = str(c.name).trim();
  if (!name) return null;
  const photos: ClientPhoto[] = arr(c.photos)
    .filter((p) => p && typeof p === 'object' && p.id && typeof p.url === 'string')
    .map((p) => ({ id: String(p.id), date: str(p.date), url: p.url, label: str(p.label), appointmentId: p.appointmentId ? String(p.appointmentId) : undefined }));
  return {
    ...c,
    id: String(c.id),
    name,
    tone: str(c.tone, '#C49A7A'),
    phone: str(c.phone),
    email: str(c.email),
    since: str(c.since),
    hair: {
      type: str(c.hair?.type),
      length: str(c.hair?.length),
      natural: str(c.hair?.natural),
    },
    formula: str(c.formula),
    allergies: str(c.allergies),
    notes: str(c.notes),
    photos,
  };
}

function sanitizeProduct(p: any): Product | null {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const name = str(p.name).trim();
  if (!name) return null;
  return {
    ...p,
    id: String(p.id),
    name,
    brand: str(p.brand),
    category: str(p.category),
    size: num(p.size, 1) || 1, // size divides usage amounts — never let it be 0
    unit: str(p.unit, 'ml'),
    stock: num(p.stock),
    reorder: num(p.reorder),
    perUse: num(p.perUse),
    cost: num(p.cost),
    status: p.status === 'low' || p.status === 'out' ? p.status : 'ok',
  };
}

function sanitizeAppointment(a: any): Appointment | null {
  if (!a || typeof a !== 'object' || !a.id || !a.clientId) return null;
  if (!validDate(a.start) || !validDate(a.end)) return null;
  return {
    ...a,
    id: String(a.id),
    clientId: String(a.clientId),
    start: a.start,
    end: a.end,
    service: str(a.service),
    status: STATUSES.includes(a.status) ? a.status : 'upcoming',
    price: num(a.price),
    products: arr(a.products)
      .filter((p) => p && typeof p === 'object' && p.productId)
      .map((p) => ({ productId: String(p.productId), amount: num(p.amount) })),
  };
}

function sanitizeService(s: any): Service | null {
  if (!s || typeof s !== 'object' || !s.id) return null;
  const name = str(s.name).trim();
  if (!name) return null;
  return {
    ...s,
    id: String(s.id),
    name,
    duration: num(s.duration, 60) || 60,
    price: num(s.price),
    defaults: arr(s.defaults).filter((x) => typeof x === 'string'),
    recommended: arr(s.recommended).filter((x) => typeof x === 'string'),
  };
}

function sanitizeSchedule(s: any): Schedule {
  const out: Schedule = {};
  if (!s || typeof s !== 'object') return out;
  for (const [day, info] of Object.entries(s)) {
    const d = Number(day);
    if (!Number.isInteger(d) || d < 0 || d > 6) continue;
    if (!info || typeof info !== 'object') continue;
    const i = info as any;
    out[d] = { open: !!i.open, start: str(i.start, '09:00'), end: str(i.end, '17:00') };
  }
  return out;
}

/** Repairs an external payload so nothing downstream can crash on a malformed record. */
export function sanitizePayload(data: ExportPayload): ExportPayload {
  return {
    version: 1,
    exported: str(data?.exported),
    clients: arr(data?.clients).map(sanitizeClient).filter((c): c is Client => c !== null),
    products: arr(data?.products).map(sanitizeProduct).filter((p): p is Product => p !== null),
    appointments: arr(data?.appointments).map(sanitizeAppointment).filter((a): a is Appointment => a !== null),
    services: arr(data?.services).map(sanitizeService).filter((s): s is Service => s !== null),
    schedule: sanitizeSchedule(data?.schedule),
    tombstones: data?.tombstones && typeof data.tombstones === 'object' ? data.tombstones : undefined,
  };
}
