import { slotsOverlap, hasConflict } from '../booking';

const d = (h: number, m = 0) => new Date(2026, 0, 1, h, m);

describe('slotsOverlap', () => {
  it('detects a partial overlap', () => {
    expect(slotsOverlap(d(10), d(11), d(10, 30), d(11, 30))).toBe(true);
  });
  it('treats touching edges as not overlapping', () => {
    expect(slotsOverlap(d(10), d(11), d(11), d(12))).toBe(false);
  });
  it('treats disjoint intervals as not overlapping', () => {
    expect(slotsOverlap(d(10), d(11), d(12), d(13))).toBe(false);
  });
  it('detects a fully contained interval', () => {
    expect(slotsOverlap(d(10), d(13), d(11), d(12))).toBe(true);
  });
});

describe('hasConflict', () => {
  const busy = [
    { start: d(9), end: d(10) },
    { start: d(14), end: d(15) },
  ];
  it('is true when colliding with any busy slot', () => {
    expect(hasConflict(d(9, 30), d(10, 30), busy)).toBe(true);
  });
  it('is false when the slot is free', () => {
    expect(hasConflict(d(11), d(12), busy)).toBe(false);
  });
  it('is false against an empty busy list', () => {
    expect(hasConflict(d(11), d(12), [])).toBe(false);
  });
});
