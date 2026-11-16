import fs from 'fs';
import path from 'path';
import {
  DEFAULT_TIERS, validTiers, describeTiers, tiersFromForm, formFromTiers, type RefundTier,
} from '../policy';

/**
 * Her cancellation policy: the schedule the service refunds by, and the lines
 * a client reads before agreeing to it.
 */

/** The booking page's own copy of the wording, lifted out of book.js. */
function pageScheduleLines(): (tiers: RefundTier[], depositMinor?: number | null) => string[] {
  const src = fs.readFileSync(path.join(__dirname, '../../../booking/site/book.js'), 'utf8');
  const money = src.match(/const money = [^\n]+\n/)![0];
  const hours = src.match(/const hoursLabel = [^\n]+\n/)![0];
  const start = src.indexOf('function scheduleLines');
  const fn = src.slice(start, src.indexOf('\n}\n', start) + 3);
  // eslint-disable-next-line no-new-func
  return new Function(`${money}${hours}${fn}; return scheduleLines;`)();
}

describe('what a client reads', () => {
  it('her default terms, with real amounts', () => {
    expect(describeTiers(DEFAULT_TIERS, 4500)).toEqual([
      '48 hours or more before: your deposit back in full',
      '24 hours to 48 hours before: £22.50 back (50%)',
      'Less than 24 hours before: no refund',
    ]);
  });

  it('whole days read as days', () => {
    const tiers = [{ minNoticeHours: 72, refundPct: 100 }, { minNoticeHours: 0, refundPct: 0 }];
    expect(describeTiers(tiers)).toEqual([
      '3 days or more before: your deposit back in full',
      'Less than 3 days before: no refund',
    ]);
  });

  it('the booking page says exactly what the app previews', () => {
    // She edits in the app; clients read the page. A preview that differs from
    // the page is a preview of something nobody sees.
    const page = pageScheduleLines();
    for (const [tiers, deposit] of [
      [DEFAULT_TIERS, 4500],
      [DEFAULT_TIERS, null],
      [tiersFromForm({ fullHours: 168, partialHours: 48, partialPct: 25 }), 2999],
      [[{ minNoticeHours: 0, refundPct: 0 }], 4500],
    ] as [RefundTier[], number | null][]) {
      expect(page(tiers, deposit)).toEqual(describeTiers(tiers, deposit));
    }
  });
});

describe('the editor', () => {
  it('turns her three numbers into a schedule the service accepts', () => {
    const tiers = tiersFromForm({ fullHours: 72, partialHours: 24, partialPct: 50 });
    expect(validTiers(tiers)).toEqual(tiers);
  });

  it('no partial refund means no middle tier', () => {
    expect(tiersFromForm({ fullHours: 48, partialHours: 24, partialPct: 0 }))
      .toEqual([{ minNoticeHours: 48, refundPct: 100 }, { minNoticeHours: 0, refundPct: 0 }]);
  });

  it('a partial window that is not shorter than the full one is dropped, not saved backwards', () => {
    const tiers = tiersFromForm({ fullHours: 24, partialHours: 48, partialPct: 50 });
    expect(validTiers(tiers)).not.toBeNull();
    expect(tiers).toHaveLength(2);
  });

  it('reads a saved schedule back into the same numbers', () => {
    const form = { fullHours: 72, partialHours: 24, partialPct: 25 };
    expect(formFromTiers(tiersFromForm(form))).toEqual(form);
    expect(formFromTiers(null)).toEqual({ fullHours: 48, partialHours: 24, partialPct: 50 });
  });

  it('refuses the same schedules the service refuses', () => {
    expect(validTiers([{ minNoticeHours: 24, refundPct: 100 }])).toBeNull();
    expect(validTiers([{ minNoticeHours: 48, refundPct: 50 }, { minNoticeHours: 0, refundPct: 100 }])).toBeNull();
    expect(validTiers(DEFAULT_TIERS)).toEqual(DEFAULT_TIERS);
  });
});
