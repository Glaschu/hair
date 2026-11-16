import { Appointment, ApptProduct, Client, Product } from './types';
import { deductStock, restoreStock } from './stock';

export interface ChairOccupant {
  /** Upcoming appointment happening right now (start <= now < end, today). */
  current?: Appointment;
  /** Earliest upcoming appointment later today. */
  next?: Appointment;
  /** The one to show chair-side: current, else next. */
  hero?: Appointment;
}

/** Who is (or is about to be) in the chair today. */
export function chairOccupant(appointments: Appointment[], now: Date): ChairOccupant {
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  const day1 = new Date(day0);
  day1.setDate(day1.getDate() + 1);

  const today = appointments
    .filter((a) => a.status === 'upcoming')
    .filter((a) => {
      const d = new Date(a.start);
      return d >= day0 && d < day1;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const current = today.find((a) => new Date(a.start) <= now && new Date(a.end) > now);
  const next = today.find((a) => new Date(a.start) > now);
  return { current, next, hero: current ?? next };
}

export interface StockAlert {
  name: string;
  isOut: boolean;
}

/**
 * Deduct an appointment's product usage from stock. Alerts contain only
 * threshold *crossings* (ok→low, →out), matching the notification behavior
 * of the original per-screen completion code.
 */
export function deductUsage(
  products: Product[],
  usage: ApptProduct[],
): { products: Product[]; alerts: StockAlert[] } {
  const alerts: StockAlert[] = [];
  const next = products.map((p) => {
    const used = usage.find((u) => u.productId === p.id);
    if (!used) return p;
    const after = deductStock(p, used.amount);
    if (after.status !== 'ok' && after.status !== p.status) {
      alerts.push({ name: p.name, isOut: after.status === 'out' });
    }
    return after;
  });
  return { products: next, alerts };
}

/** Reverse an appointment's product usage (un-completing a visit). */
export function restoreUsage(products: Product[], usage: ApptProduct[]): Product[] {
  return products.map((p) => {
    const used = usage.find((u) => u.productId === p.id);
    return used ? restoreStock(p, used.amount) : p;
  });
}

/**
 * Correct one product's recorded usage after completion, keeping stock
 * truthful: the old deduction is restored, then the new amount deducted.
 */
export function adjustCompletedUsage(
  products: Product[],
  productId: string,
  oldAmount: number,
  newAmount: number,
): Product[] {
  return products.map((p) =>
    p.id === productId ? deductStock(restoreStock(p, oldAmount), newAmount) : p,
  );
}

export interface TreatmentSummaryRow {
  service: string;
  count: number;
  /** ISO start of the most recent time this service was done. */
  last: string;
}

/** Completed services grouped for the client card: what they have, how often, when last. */
export function treatmentSummary(clientId: string, appointments: Appointment[]): TreatmentSummaryRow[] {
  const rows = new Map<string, TreatmentSummaryRow>();
  for (const a of appointments) {
    if (a.clientId !== clientId || a.status !== 'completed' || !a.service) continue;
    const existing = rows.get(a.service);
    if (!existing) {
      rows.set(a.service, { service: a.service, count: 1, last: a.start });
    } else {
      existing.count += 1;
      if (new Date(a.start) > new Date(existing.last)) existing.last = a.start;
    }
  }
  return Array.from(rows.values()).sort(
    (x, y) => new Date(y.last).getTime() - new Date(x.last).getTime(),
  );
}

export interface VisitContext {
  /** Most recent completed appointment for this client. */
  lastCompleted?: Appointment;
  /** Up to 3 completed appointments, newest first. */
  recentCompleted: Appointment[];
  /** Formula to work from: last visit's formula wins over the client card. */
  effectiveFormula: string;
  /** The "next time" plan recorded at the last visit, if any. */
  nextPlan?: { text: string; date: string; appointmentId: string };
}

/**
 * Everything the chair-side view needs about a client's history.
 * `excludeAppointmentId` keeps the appointment being viewed/edited from
 * counting as its own history (e.g. the wrap-up screen's formula prefill).
 */
export function clientVisitContext(
  clientId: string,
  appointments: Appointment[],
  client: Client | undefined,
  opts?: { excludeAppointmentId?: string },
): VisitContext {
  const completed = appointments
    .filter(
      (a) =>
        a.clientId === clientId &&
        a.status === 'completed' &&
        a.id !== opts?.excludeAppointmentId,
    )
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  const lastCompleted = completed[0];
  return {
    lastCompleted,
    recentCompleted: completed.slice(0, 3),
    effectiveFormula: lastCompleted?.formula || client?.formula || '',
    nextPlan: lastCompleted?.nextNotes
      ? { text: lastCompleted.nextNotes, date: lastCompleted.start, appointmentId: lastCompleted.id }
      : undefined,
  };
}
