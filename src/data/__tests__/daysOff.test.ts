import {
  dateKey, fromKey, dayOffOn, closedOn, serviceRanges, upcomingDaysOff, openDay,
  describeDayOff, appointmentsOnDaysOff, type DayOff,
} from '../daysOff';
import type { Appointment, Schedule } from '../types';

/**
 * Days she blocks off — the exceptions to her weekly hours.
 *
 * The tests that matter most are about dates: a day off has to be the same
 * day on her phone, her iPad and the booking service.
 */

const holiday: DayOff = { id: 'h1', start: '2026-12-20', end: '2026-12-27', note: 'Holiday' };
const weekly: Schedule = {
  0: { open: false, start: '09:00', end: '17:00' }, // Sundays off
  1: { open: true, start: '09:00', end: '17:00' },
  2: { open: true, start: '09:00', end: '17:00' },
  3: { open: true, start: '09:00', end: '17:00' },
  4: { open: true, start: '09:00', end: '17:00' },
  5: { open: true, start: '09:00', end: '17:00' },
  6: { open: true, start: '09:00', end: '17:00' },
};
let n = 0;
const newId = () => `new-${++n}`;

describe('which days are off', () => {
  it('covers every day of a holiday, both ends included', () => {
    expect(dayOffOn([holiday], new Date(2026, 11, 20, 9))).toBe(holiday);
    expect(dayOffOn([holiday], new Date(2026, 11, 27, 23, 59))).toBe(holiday);
    expect(dayOffOn([holiday], new Date(2026, 11, 28, 0, 1))).toBeNull();
  });

  it('a late-evening appointment is still on its own date, not the next', () => {
    // toISOString would have said the 21st for 11:30pm in BST.
    expect(dateKey(new Date(2026, 5, 20, 23, 30))).toBe('2026-06-20');
  });

  it('days off and weekly closures are both "closed", and say which', () => {
    expect(closedOn(weekly, [holiday], new Date(2026, 11, 22))).toMatchObject({ closed: true, reason: 'day-off' });
    expect(closedOn(weekly, [], new Date(2026, 11, 20))).toMatchObject({ closed: true, reason: 'weekly' }); // a Sunday
    expect(closedOn(weekly, [], new Date(2026, 11, 22))).toMatchObject({ closed: false });
  });
});

describe('what the booking service is told', () => {
  it('local midnight to local midnight, the day after the last day off', () => {
    const [r] = serviceRanges([holiday], new Date(2026, 11, 1));
    expect(r.from).toBe(new Date(2026, 11, 20).toISOString());
    expect(r.to).toBe(new Date(2026, 11, 28).toISOString());
  });

  it('a holiday across the clocks changing still covers whole local days', () => {
    // 25 Oct 2026 the UK goes back an hour: the range is 25 hours long, not 24.
    const [r] = serviceRanges([{ id: 'x', start: '2026-10-25', end: '2026-10-25' }], new Date(2026, 9, 1));
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(
      new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime(),
    );
  });

  it('days off already over are not sent', () => {
    expect(serviceRanges([holiday], new Date(2027, 0, 5))).toEqual([]);
    expect(upcomingDaysOff([holiday], new Date(2026, 11, 27))).toEqual([holiday]);
  });
});

describe('opening a day again', () => {
  it('a single day off is simply gone', () => {
    expect(openDay([{ id: 'd', start: '2026-12-22', end: '2026-12-22' }], new Date(2026, 11, 22), newId)).toEqual([]);
  });

  it('the middle of a holiday splits it, keeping the days either side', () => {
    const out = openDay([holiday], new Date(2026, 11, 23), newId, 5);
    expect(out.map((d) => [d.start, d.end])).toEqual([['2026-12-20', '2026-12-22'], ['2026-12-24', '2026-12-27']]);
    expect(out[0].id).toBe('h1');
    expect(out[1].note).toBe('Holiday');
    expect(out.every((d) => d.updatedAt === 5)).toBe(true);
  });

  it('the first or last day just shortens it', () => {
    expect(openDay([holiday], new Date(2026, 11, 20), newId).map((d) => [d.id, d.start, d.end]))
      .toEqual([['h1', '2026-12-21', '2026-12-27']]);
    expect(openDay([holiday], new Date(2026, 11, 27), newId).map((d) => [d.start, d.end]))
      .toEqual([['2026-12-20', '2026-12-26']]);
  });
});

describe('what she is told', () => {
  it('reads like she would say it', () => {
    expect(describeDayOff({ start: '2026-12-22', end: '2026-12-22' })).toBe('Tue 22 Dec');
    expect(describeDayOff(holiday)).toBe('Sun 20 – Sun 27 Dec');
    expect(describeDayOff({ start: '2026-12-31', end: '2027-01-02' })).toBe('Thu 31 Dec – Sat 2 Jan');
  });

  it('finds the appointments still booked on days she has just blocked, and only those', () => {
    const appt = (id: string, start: Date, status: Appointment['status'] = 'upcoming'): Appointment => ({
      id, clientId: 'c', start: start.toISOString(), end: start.toISOString(), service: 'Cut',
      status, price: 40, products: [],
    });
    const out = appointmentsOnDaysOff([
      appt('in', new Date(2026, 11, 22, 10)),
      appt('done', new Date(2026, 11, 22, 12), 'cancelled'),
      appt('after', new Date(2026, 11, 28, 10)),
    ], [holiday]);
    expect(out.map((a) => a.id)).toEqual(['in']);
    expect(fromKey('2026-12-22').getDate()).toBe(22);
  });
});
