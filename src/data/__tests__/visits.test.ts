import { chairOccupant, deductUsage, restoreUsage, adjustCompletedUsage, clientVisitContext, treatmentSummary } from '../visits';
import { Appointment, Client, Product } from '../types';

const at = (base: Date, h: number, m = 0) => {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const mkAppt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1',
  clientId: 'c1',
  start: new Date().toISOString(),
  end: new Date().toISOString(),
  service: 'Cut',
  status: 'upcoming',
  price: 50,
  products: [],
  ...over,
});

const mkProduct = (over: Partial<Product>): Product => ({
  id: 'p1',
  name: 'Toner',
  brand: 'Brand',
  category: 'Color',
  size: 60,
  unit: 'mL',
  stock: 5,
  reorder: 2,
  perUse: 30,
  cost: 10,
  status: 'ok',
  ...over,
});

const mkClient = (over: Partial<Client>): Client => ({
  id: 'c1',
  name: 'Margot',
  tone: '#fff',
  phone: '',
  email: '',
  since: '2024-01-01',
  hair: { type: 'Wavy', length: 'Mid', natural: 'Brown' },
  formula: '',
  allergies: 'None on file',
  notes: '',
  ...over,
});

describe('chairOccupant', () => {
  const now = new Date('2026-07-15T14:00:00');

  it('picks the in-progress appointment as current and hero', () => {
    const current = mkAppt({ id: 'now', start: at(now, 13, 30), end: at(now, 15) });
    const later = mkAppt({ id: 'later', start: at(now, 16), end: at(now, 17) });
    const r = chairOccupant([later, current], now);
    expect(r.current?.id).toBe('now');
    expect(r.next?.id).toBe('later');
    expect(r.hero?.id).toBe('now');
  });

  it('falls back to the next appointment between visits', () => {
    const later = mkAppt({ id: 'later', start: at(now, 16), end: at(now, 17) });
    const r = chairOccupant([later], now);
    expect(r.current).toBeUndefined();
    expect(r.hero?.id).toBe('later');
  });

  it('ignores non-upcoming and other days', () => {
    const done = mkAppt({ id: 'done', start: at(now, 13, 30), end: at(now, 15), status: 'completed' });
    const cancelled = mkAppt({ id: 'x', start: at(now, 16), end: at(now, 17), status: 'cancelled' });
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const notToday = mkAppt({ id: 'tmrw', start: at(tomorrow, 10), end: at(tomorrow, 11) });
    const r = chairOccupant([done, cancelled, notToday], now);
    expect(r.hero).toBeUndefined();
  });

  it('is empty once the day is over', () => {
    const morning = mkAppt({ id: 'am', start: at(now, 9), end: at(now, 10) });
    const evening = new Date(now);
    evening.setHours(20);
    expect(chairOccupant([morning], evening).hero).toBeUndefined();
  });
});

describe('deductUsage / restoreUsage', () => {
  it('deducts across multiple products and skips unknown ids', () => {
    const p1 = mkProduct({ id: 'p1', stock: 5, size: 60 });
    const p2 = mkProduct({ id: 'p2', stock: 2, size: 100 });
    const { products } = deductUsage([p1, p2], [
      { productId: 'p1', amount: 60 },
      { productId: 'p2', amount: 50 },
      { productId: 'ghost', amount: 10 },
    ]);
    expect(products[0].stock).toBe(4);
    expect(products[1].stock).toBe(1.5);
  });

  it('alerts only on threshold crossings', () => {
    const ok = mkProduct({ id: 'p1', stock: 3, reorder: 2, size: 60 });        // 3 → 2 crosses into low
    const alreadyLow = mkProduct({ id: 'p2', stock: 1, reorder: 2, size: 60, status: 'low' }); // stays low
    const { alerts } = deductUsage([ok, alreadyLow], [
      { productId: 'p1', amount: 60 },
      { productId: 'p2', amount: 6 },
    ]);
    expect(alerts).toEqual([{ name: 'Toner', isOut: false }]);
  });

  it('restore reverses a deduction', () => {
    const p = mkProduct({ id: 'p1', stock: 1, size: 60, status: 'low' });
    const restored = restoreUsage([p], [{ productId: 'p1', amount: 120 }]);
    expect(restored[0].stock).toBe(3);
    expect(restored[0].status).toBe('ok');
  });
});

describe('adjustCompletedUsage', () => {
  it('applies only the delta between old and new amounts', () => {
    const p = mkProduct({ id: 'p1', stock: 4, size: 60 });
    const adjusted = adjustCompletedUsage([p], 'p1', 30, 60);
    expect(adjusted[0].stock).toBe(3.5); // +0.5 restored, −1 deducted
  });

  it('never drives stock negative and recomputes status', () => {
    const p = mkProduct({ id: 'p1', stock: 0.5, size: 60, reorder: 2, status: 'low' });
    const adjusted = adjustCompletedUsage([p], 'p1', 0, 600);
    expect(adjusted[0].stock).toBe(0);
    expect(adjusted[0].status).toBe('out');
  });

  it('leaves other products untouched', () => {
    const p1 = mkProduct({ id: 'p1', stock: 4 });
    const p2 = mkProduct({ id: 'p2', stock: 4 });
    const adjusted = adjustCompletedUsage([p1, p2], 'p1', 0, 60);
    expect(adjusted[1]).toBe(p2);
  });
});

describe('clientVisitContext', () => {
  const now = new Date('2026-07-15T14:00:00');
  const oldVisit = mkAppt({ id: 'old', status: 'completed', start: at(new Date('2026-05-01'), 10), formula: 'old formula' });
  const lastVisit = mkAppt({
    id: 'last', status: 'completed', start: at(new Date('2026-06-20'), 10),
    formula: '30g 6N + 20vol', nextNotes: 'go half a shade cooler',
  });
  const otherClient = mkAppt({ id: 'other', clientId: 'c2', status: 'completed', start: at(now, 9) });

  it('finds the latest completed visit and its plan', () => {
    const ctx = clientVisitContext('c1', [oldVisit, lastVisit, otherClient], mkClient({}));
    expect(ctx.lastCompleted?.id).toBe('last');
    expect(ctx.effectiveFormula).toBe('30g 6N + 20vol');
    expect(ctx.nextPlan).toEqual({ text: 'go half a shade cooler', date: lastVisit.start, appointmentId: 'last' });
    expect(ctx.recentCompleted.map((a) => a.id)).toEqual(['last', 'old']);
  });

  it('falls back to the client card formula, then empty', () => {
    const bare = mkAppt({ id: 'nf', status: 'completed', start: at(now, 9) });
    expect(clientVisitContext('c1', [bare], mkClient({ formula: 'card formula' })).effectiveFormula).toBe('card formula');
    expect(clientVisitContext('c1', [], mkClient({})).effectiveFormula).toBe('');
    expect(clientVisitContext('c1', [], undefined).effectiveFormula).toBe('');
  });

  it('caps recentCompleted at 3, newest first', () => {
    const visits = [1, 2, 3, 4].map((i) =>
      mkAppt({ id: `v${i}`, status: 'completed', start: at(new Date(`2026-0${i}-01`), 10) }));
    const ctx = clientVisitContext('c1', visits, undefined);
    expect(ctx.recentCompleted.map((a) => a.id)).toEqual(['v4', 'v3', 'v2']);
  });

  it('excludes the appointment being edited from its own history', () => {
    const ctx = clientVisitContext('c1', [lastVisit, oldVisit], mkClient({}), { excludeAppointmentId: 'last' });
    expect(ctx.lastCompleted?.id).toBe('old');
    expect(ctx.effectiveFormula).toBe('old formula');
    expect(ctx.nextPlan).toBeUndefined();
  });
});

describe('treatmentSummary', () => {
  it('groups completed services with counts and most-recent date', () => {
    const appts = [
      mkAppt({ id: 'a', service: 'Cut', status: 'completed', start: '2026-01-01T10:00:00.000Z' }),
      mkAppt({ id: 'b', service: 'Cut', status: 'completed', start: '2026-06-01T10:00:00.000Z' }),
      mkAppt({ id: 'c', service: 'Colour', status: 'completed', start: '2026-03-01T10:00:00.000Z' }),
    ];
    const rows = treatmentSummary('c1', appts);
    expect(rows).toEqual([
      { service: 'Cut', count: 2, last: '2026-06-01T10:00:00.000Z' },
      { service: 'Colour', count: 1, last: '2026-03-01T10:00:00.000Z' },
    ]);
  });

  it('ignores other clients and non-completed visits', () => {
    const appts = [
      mkAppt({ id: 'a', service: 'Cut', status: 'completed', clientId: 'c2' }),
      mkAppt({ id: 'b', service: 'Cut', status: 'upcoming' }),
      mkAppt({ id: 'c', service: 'Cut', status: 'no-show' }),
    ];
    expect(treatmentSummary('c1', appts)).toEqual([]);
  });
});
