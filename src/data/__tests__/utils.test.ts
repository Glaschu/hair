import { checkSchedule, numberFieldError, generateTimeSlots } from '../utils';
import { Schedule } from '../types';

const schedule: Schedule = {
  0: { open: false, start: '00:00', end: '00:00' }, // Sunday closed
  1: { open: true, start: '09:00', end: '17:00' },  // Monday 9–5
};

// Jan 4 2026 is a Sunday, Jan 5 2026 is a Monday.
describe('checkSchedule', () => {
  it('flags a closed day', () => {
    expect(checkSchedule(schedule, new Date(2026, 0, 4, 10, 0), 60).dayClosed).toBe(true);
  });
  it('flags a start before opening time', () => {
    const r = checkSchedule(schedule, new Date(2026, 0, 5, 8, 0), 60);
    expect(r.dayClosed).toBe(false);
    expect(r.offHours).toBe(true);
  });
  it('flags an appointment that runs past closing time', () => {
    const r = checkSchedule(schedule, new Date(2026, 0, 5, 16, 30), 60);
    expect(r.offHours).toBe(true);
  });
  it('accepts an in-hours slot', () => {
    const r = checkSchedule(schedule, new Date(2026, 0, 5, 10, 0), 60);
    expect(r.dayClosed).toBe(false);
    expect(r.offHours).toBe(false);
  });
});

describe('generateTimeSlots', () => {
  const earlier = new Date(2026, 0, 1, 12, 0); // before the test dates below

  it('spans the configured studio hours on an open day', () => {
    const slots = generateTimeSlots(schedule, new Date(2026, 0, 5), earlier); // Monday
    expect(slots[0]).toEqual({ h: 9, m: 0 });
    expect(slots[slots.length - 1]).toEqual({ h: 17, m: 0 });
  });
  it('falls back to 8:00-19:00 on a closed day', () => {
    const slots = generateTimeSlots(schedule, new Date(2026, 0, 4), earlier); // Sunday
    expect(slots[0]).toEqual({ h: 8, m: 0 });
    expect(slots[slots.length - 1]).toEqual({ h: 19, m: 0 });
  });
  it('drops past times when the date is today', () => {
    const today = new Date(2026, 0, 5, 14, 0); // Monday 2pm
    const slots = generateTimeSlots(schedule, today, today);
    expect(slots[0]).toEqual({ h: 14, m: 30 });
    expect(slots.every((s) => s.h * 60 + s.m > 14 * 60)).toBe(true);
  });
});

describe('numberFieldError', () => {
  it('allows an empty value (incomplete, not invalid)', () => {
    expect(numberFieldError('', { min: 0 })).toBe('');
  });
  it('rejects non-numeric input', () => {
    expect(numberFieldError('abc', { min: 0 })).not.toBe('');
  });
  it('rejects negatives when a minimum of 0 is set', () => {
    expect(numberFieldError('-5', { min: 0 })).not.toBe('');
  });
  it('rejects zero when a positive value is required', () => {
    expect(numberFieldError('0', { positive: true })).not.toBe('');
  });
  it('accepts a valid value', () => {
    expect(numberFieldError('12.5', { min: 0 })).toBe('');
  });
});
