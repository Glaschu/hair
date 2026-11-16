import {
  planIntake, runIntake, phoneKey, appointmentIdFor, type IntakePlan,
} from '../intake';
import type { IncomingBooking } from '../bookingApi';
import type { Appointment, Client } from '../types';

/**
 * Taking a web booking into the diary.
 *
 * Every test here is really the same question asked from a different angle:
 * after this goes wrong, does the client still have their appointment? The
 * answer has to be yes for every way it can go wrong, because the alternative
 * is a stranger turning up on a Saturday that her diary says is free.
 */

const BOOKED_AT = Date.UTC(2026, 8, 20, 10, 0, 0);


const booking = (over: Partial<IncomingBooking> = {}): IncomingBooking => ({
  id: 'b1',
  token: 'tok1',
  clientRef: 'ref-1',
  serviceName: 'Full head colour',
  durationMins: 180,
  priceMinor: 9000,
  startsAt: '2026-09-26T09:00:00.000Z',
  endsAt: '2026-09-26T12:00:00.000Z',
  createdAt: BOOKED_AT,
  details: { name: 'Ada Bell', phone: '07700 900123', email: 'ada@example.com' },
  ...over,
});

const client = (over: Partial<Client> = {}): Client => ({
  id: 'existing-1',
  name: 'Ada Bell',
  tone: '',
  phone: '+44 7700 900123',
  email: 'ada@example.com',
  since: '2024-01-01',
  hair: { type: '', length: '', natural: '' },
  formula: '',
  allergies: '',
  notes: '',
  ...over,
});

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'bk_b1',
  clientId: 'existing-1',
  start: '2026-09-26T09:00:00.000Z',
  end: '2026-09-26T12:00:00.000Z',
  service: 'Full head colour',
  status: 'upcoming',
  price: 90,
  products: [],
  ...over,
});

const plan = (incoming: IncomingBooking[], clients: Client[] = [], appointments: Appointment[] = []) =>
  planIntake(incoming, { clients, appointments });

describe('a booking arriving', () => {
  it('becomes an appointment in the diary', () => {
    const out = plan([booking()]);
    expect(out.appointments).toHaveLength(1);
    expect(out.appointments[0]).toMatchObject({
      start: '2026-09-26T09:00:00.000Z',
      service: 'Full head colour',
      status: 'upcoming',
      price: 90,
    });
  });

  it('carries what they typed when booking through to the diary', () => {
    // She reads this in the chair. Losing it is losing the only thing the
    // client thought to tell her.
    const out = plan([booking({ details: { name: 'Ada', phone: '07700900123', note: 'growing out a fringe' } })]);
    expect(out.appointments[0].notes).toBe('growing out a fringe');
  });

  it('prices in pounds, because minor units in the diary would be a 9000 pound colour', () => {
    expect(plan([booking({ priceMinor: 4995 })]).appointments[0].price).toBe(49.95);
  });

  it('is only acknowledged once it is in the diary', () => {
    const out = plan([booking()]);
    expect(out.seen).toEqual(['b1']);
  });
});

describe('the same booking arriving twice', () => {
  it('does not become two appointments', () => {
    // The ordering guarantees this happens: the diary is written first, so a
    // crash before acknowledging means the service offers it again.
    const out = plan([booking()], [client()], [appt()]);
    expect(out.appointments).toHaveLength(0);
    expect(out.newClients).toHaveLength(0);
  });

  it('is acknowledged the second time, so it stops coming back', () => {
    expect(plan([booking()], [client()], [appt()]).seen).toEqual(['b1']);
  });

  it('collides with itself by id rather than by a lookup', () => {
    // Structural dedupe survives a restart and a restore from backup; a lookup
    // only works if the thing it looks in was written.
    expect(appointmentIdFor('b1')).toBe('bk_b1');
    expect(plan([booking(), booking()]).appointments).toHaveLength(1);
  });
});

describe('an envelope that will not open', () => {
  const unreadable = booking({ details: null });

  it('is never dropped', () => {
    expect(plan([unreadable]).needsAttention).toHaveLength(1);
  });

  it('is never acknowledged, so the service keeps offering it', () => {
    // This is the difference between "she has to look at this" and the booking
    // being gone for good. Recovering the right key has to be able to rescue it.
    expect(plan([unreadable]).seen).toEqual([]);
  });

  it('does not stop the rest of the batch going in', () => {
    const out = plan([unreadable, booking({ id: 'b2' })]);
    expect(out.appointments).toHaveLength(1);
    expect(out.seen).toEqual(['b2']);
    expect(out.needsAttention).toHaveLength(1);
  });
});

describe('who the booking belongs to', () => {
  it('matches a regular whose number is stored in another format', () => {
    // "+44 7700 900123" in her contacts, "07700 900123" typed on the web.
    const out = plan([booking()], [client()]);
    expect(out.newClients).toHaveLength(0);
    expect(out.appointments[0].clientId).toBe('existing-1');
  });

  it('matches on email when the number is new', () => {
    const out = plan([booking({ details: { name: 'Ada Bell', phone: '07999 111222', email: 'ADA@example.com' } })],
      [client()]);
    expect(out.newClients).toHaveLength(0);
    expect(out.appointments[0].clientId).toBe('existing-1');
  });

  it('creates a card for someone genuinely new', () => {
    const out = plan([booking()]);
    expect(out.newClients).toHaveLength(1);
    expect(out.newClients[0]).toMatchObject({ name: 'Ada Bell', phone: '07700 900123' });
    expect(out.appointments[0].clientId).toBe(out.newClients[0].id);
  });

  it('treats two bookings from one new client as one client', () => {
    const out = plan([booking(), booking({ id: 'b2', startsAt: '2026-10-03T09:00:00.000Z' })]);
    expect(out.newClients).toHaveLength(1);
    expect(out.appointments[0].clientId).toBe(out.appointments[1].clientId);
  });

  it('never collapses two people who both left the number blank', () => {
    const out = plan([
      booking({ id: 'b1', details: { name: 'One', phone: '' } }),
      booking({ id: 'b2', details: { name: 'Two', phone: '' } }),
    ]);
    expect(out.newClients).toHaveLength(2);
  });

  it('will not match on a fragment too short to identify anyone', () => {
    expect(phoneKey('123')).toBe('');
    expect(phoneKey('07700 900123')).toBe(phoneKey('+44 7700 900123'));
    expect(phoneKey('')).toBe('');
  });

  it('matches every way a UK number is commonly written', () => {
    const key = phoneKey('07700 900123');
    for (const written of ['0044 7700 900123', '+44 (0)7700 900123', '447700900123', '(07700) 900-123']) {
      expect(phoneKey(written)).toBe(key);
    }
  });

  it('leaves numbers from elsewhere whole', () => {
    // An Irish mobile written internationally keeps its country code, and a
    // local number that happens to begin 44 is not cut short.
    expect(phoneKey('+353 87 123 4567')).toBe('353871234567');
    expect(phoneKey('0035387 123 4567')).toBe('353871234567');
    expect(phoneKey('4412345678')).toBe('4412345678');
    expect(phoneKey('+1 415 555 0100')).not.toBe(phoneKey('415 555 0100'));
  });
});

describe('applying it, when things fail', () => {
  const run = (over: Partial<Parameters<typeof runIntake>[1]> = {}, incoming = [booking()]) => {
    const applied: IntakePlan[] = [];
    const order: string[] = [];
    return {
      applied,
      order,
      report: runIntake(incoming, {
        clients: [],
        appointments: [],
        apply: async (p) => { order.push('apply'); applied.push(p); },
        markSeen: async (id) => { order.push(`seen:${id}`); },
        ...over,
      }),
    };
  };

  it('writes the diary BEFORE telling the service — the whole invariant', async () => {
    const r = run();
    await r.report;
    expect(r.order).toEqual(['apply', 'seen:b1']);
  });

  it('acknowledges nothing if the diary could not be written', async () => {
    const seen: string[] = [];
    await expect(runIntake([booking()], {
      clients: [], appointments: [],
      apply: async () => { throw new Error('disk full'); },
      markSeen: async (id) => { seen.push(id); },
    })).rejects.toThrow('disk full');
    // Not one acknowledgement escaped, so the whole batch is offered again.
    expect(seen).toEqual([]);
  });

  it('keeps the booking when only the acknowledgement fails', async () => {
    // The appointment is already safe. The service has simply not been told,
    // so it re-offers — and the id it would take is taken.
    const r = run({ markSeen: async () => { throw new Error('offline'); } });
    const report = await r.report;
    expect(report.added).toBe(1);
    expect(report.unacknowledged).toEqual(['b1']);
    expect(r.applied[0].appointments).toHaveLength(1);
  });

  it('does not bother the diary when there is nothing to write', async () => {
    const r = run({}, [booking({ details: null })]);
    const report = await r.report;
    expect(r.order).toEqual([]);
    expect(report.needsAttention).toHaveLength(1);
  });

  it('reports a re-delivery as such rather than as a new booking', async () => {
    const report = await runIntake([booking()], {
      clients: [client()], appointments: [appt()],
      apply: async () => {},
      markSeen: async () => {},
    });
    expect(report).toMatchObject({ added: 0, redelivered: 1, newClients: 0 });
  });
});

describe('a booking she has since deleted', () => {
  it('is acknowledged, and never brought back', async () => {
    // If the acknowledgement never landed and she deleted the appointment,
    // every pull used to recreate it — and its client.
    const out = planIntake([booking()], {
      clients: [], appointments: [], deleted: [appointmentIdFor('b1')],
    });
    expect(out.appointments).toHaveLength(0);
    expect(out.newClients).toHaveLength(0);
    expect(out.seen).toEqual(['b1']);
  });

  it('one that can never be acknowledged is named, not lumped in with a blip', async () => {
    const unversioned = Object.assign(new Error('old'), { name: 'UnversionedBookingError' });
    const report = await runIntake([booking(), booking({ id: 'b2' })], {
      clients: [], appointments: [],
      apply: async () => {},
      markSeen: async (id) => { throw id === 'b1' ? unversioned : new Error('offline'); },
    });
    expect(report.unacknowledged).toEqual(['b1', 'b2']);
    expect(report.stuck).toEqual(['b1']);
  });
});

describe('a booking made through a link sent from a client card', () => {
  // A card she knows only from Instagram: no phone, no email.
  const instaOnly = client({ id: 'ada-card', name: 'Ada Bell', phone: '', email: '' });
  const fromLink = (over: Partial<IncomingBooking> = {}) => booking({ clientRef: 'ref-ada', ...over });
  const refs = (ref: string) => (ref === 'ref-ada' ? 'ada-card' : null);

  it('lands on that card, even with nothing else to match on', () => {
    const out = planIntake([fromLink()], { clients: [instaOnly], appointments: [], clientForRef: refs });
    expect(out.newClients).toHaveLength(0);
    expect(out.appointments[0].clientId).toBe('ada-card');
  });

  it('beats a phone number that happens to match someone else', () => {
    // A shared family number: the link is the stronger evidence.
    const sibling = client({ id: 'sib', name: 'Ann Bell', phone: '07700 900123' });
    const out = planIntake([fromLink()], { clients: [sibling, instaOnly], appointments: [], clientForRef: refs });
    expect(out.appointments[0].clientId).toBe('ada-card');
  });

  it('fills in the number and email her card was missing', () => {
    const out = planIntake([fromLink()], {
      clients: [instaOnly], appointments: [], clientForRef: refs, now: 5,
    });
    expect(out.clientUpdates).toEqual([
      { id: 'ada-card', patch: { phone: '07700 900123', email: 'ada@example.com', updatedAt: 5 } },
    ]);
  });

  it('never overwrites what she already has', () => {
    const known = client({ id: 'ada-card', phone: '07999 000000', email: 'old@example.com' });
    const out = planIntake([fromLink()], { clients: [known], appointments: [], clientForRef: refs });
    expect(out.clientUpdates).toEqual([]);
  });

  it('when someone else books through the link, it is flagged — and their number stays off her card', () => {
    // Forwarded to a partner, say. Still her client's booking, but she has to
    // know who is actually coming.
    const out = planIntake([fromLink({ details: { name: 'Bea Smith', phone: '07111 222333' } })], {
      clients: [instaOnly], appointments: [], clientForRef: refs,
    });
    expect(out.appointments[0].clientId).toBe('ada-card');
    expect(out.appointments[0].notes).toMatch(/^Booked online as Bea Smith \(07111 222333\)\./);
    expect(out.clientUpdates).toEqual([]);
  });

  it('falls back to the number when the card has since been deleted', () => {
    const regular = client({ id: 'other-card' });
    const out = planIntake([fromLink()], {
      clients: [instaOnly, regular], appointments: [], clientForRef: refs, deleted: ['ada-card'],
    });
    expect(out.appointments[0].clientId).toBe('other-card');
  });

  it('a reference nobody can resolve is just no evidence', () => {
    const out = planIntake([fromLink({ clientRef: 'unknown' })], {
      clients: [client()], appointments: [], clientForRef: refs,
    });
    expect(out.appointments[0].clientId).toBe('existing-1');
  });
});

describe('what each status means for her diary', () => {
  it('a booking cancelled before she ever pulled it never appears', () => {
    // It used to arrive as a live appointment: a no-show she would wait for.
    const out = plan([booking({ status: 'cancelled' })]);
    expect(out.appointments).toHaveLength(0);
    expect(out.newClients).toHaveLength(0);
    expect(out.seen).toEqual(['b1']);
  });

  it('a booking cancelled after she pulled it is marked cancelled, and says by whom', () => {
    const out = planIntake([booking({ status: 'cancelled' })], {
      clients: [client()], appointments: [appt({ notes: 'balayage' })], now: 9,
    });
    expect(out.cancellations).toEqual([
      { id: 'bk_b1', notes: 'balayage\nCancelled online by the client.', updatedAt: 9 },
    ]);
    expect(out.seen).toEqual(['b1']);
  });

  it('one she already finished or marked a no-show is left alone', () => {
    const out = planIntake([booking({ status: 'cancelled' })], {
      clients: [client()], appointments: [appt({ status: 'completed' })],
    });
    expect(out.cancellations).toEqual([]);
  });

  it('a booking still at Stripe is neither added nor acknowledged, so it comes back once paid', () => {
    const out = plan([booking({ status: 'pending_payment' })]);
    expect(out.appointments).toHaveLength(0);
    expect(out.seen).toEqual([]);
  });

  it('one that expired unpaid, or lost its hour while paying, is acknowledged and left out', () => {
    const out = plan([booking({ id: 'b1', status: 'expired' }), booking({ id: 'b2', status: 'slot_lost' })]);
    expect(out.appointments).toHaveLength(0);
    expect(out.seen).toEqual(['b1', 'b2']);
  });

  it('an already-imported booking is never flagged as unreadable', () => {
    // Re-delivered after her key changed: it is in the diary already, so the
    // envelope does not matter and there is nothing to warn her about.
    const out = planIntake([booking({ details: null })], { clients: [client()], appointments: [appt()] });
    expect(out.needsAttention).toEqual([]);
    expect(out.seen).toEqual(['b1']);
  });
});

describe('a booking with an unreadable creation time', () => {
  it('still comes in, and does not stop the rest of the batch', () => {
    // One bad document used to throw and fail every pull.
    const out = planIntake([booking({ createdAt: NaN as number }), booking({ id: 'b2' })], {
      clients: [], appointments: [], now: Date.UTC(2026, 8, 21),
    });
    expect(out.appointments).toHaveLength(2);
    expect(out.newClients[0].since).toMatch(/^2026-09-2[01]$/);
  });
});
