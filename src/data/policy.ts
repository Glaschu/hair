/**
 * Her cancellation policy: the words clients read, and the refund schedule the
 * service actually applies to a deposit.
 *
 * The two are stored together and pinned together to every link, so a client
 * is held to exactly what they were shown. The schedule is also shown to them
 * as plain lines under her words — generated from the numbers, never typed —
 * so even if her wording drifts from the numbers, what they agree to includes
 * what will actually happen.
 */

/** A notice threshold and how much of the deposit comes back at or above it. */
export interface RefundTier {
  minNoticeHours: number;
  refundPct: number;
}

/** What every salon starts with, and the terms Jessie posts on Instagram. */
export const DEFAULT_TIERS: RefundTier[] = [
  { minNoticeHours: 48, refundPct: 100 },
  { minNoticeHours: 24, refundPct: 50 },
  { minNoticeHours: 0, refundPct: 0 },
];

/** The same rule the service enforces — checked here so she is told before saving, not after. */
export function validTiers(tiers: unknown): RefundTier[] | null {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 5) return null;
  let prev: RefundTier | null = null;
  for (const t of tiers as RefundTier[]) {
    if (!t || !Number.isFinite(t.minNoticeHours) || !Number.isInteger(t.refundPct)) return null;
    if (t.minNoticeHours < 0 || t.minNoticeHours > 24 * 90 || t.refundPct < 0 || t.refundPct > 100) return null;
    if (prev && (t.minNoticeHours >= prev.minNoticeHours || t.refundPct > prev.refundPct)) return null;
    prev = t;
  }
  if (prev!.minNoticeHours !== 0) return null;
  return (tiers as RefundTier[]).map(({ minNoticeHours, refundPct }) => ({ minNoticeHours, refundPct }));
}

/**
 * "48 hours", "3 days". Salons say 24 and 48 hours, so those stay in hours to
 * match her own wording; whole days from three up.
 */
export function hoursLabel(h: number): string {
  if (h >= 72 && h % 24 === 0) return `${h / 24} days`;
  return h === 1 ? '1 hour' : `${h} hours`;
}

/**
 * A deposit amount, from pence. Always pounds, whatever her display currency:
 * the service charges deposits in GBP (firebase/src/deposit.mjs), and the
 * booking page says "£" — an amount of real money shown under another symbol
 * is a wrong amount. Exact, never rounded: £22.50 is not "£23".
 */
export function depositMoney(minor: number): string {
  const v = minor / 100;
  return `£${Number.isInteger(v) ? v : v.toFixed(2)}`;
}
const pounds = depositMoney;

/**
 * The schedule as a client reads it, one line per tier.
 *
 * Kept word-for-word in step with `scheduleLines` in booking/site/book.js —
 * policy.test.ts checks the two agree, because the app previews what the page
 * will show.
 */
export function describeTiers(tiers: RefundTier[], depositMinor?: number | null): string[] {
  return tiers.map((t, i) => {
    const upper = i > 0 ? tiers[i - 1].minNoticeHours : null;
    const when = upper === null
      ? (t.minNoticeHours === 0 ? 'Whenever you cancel' : `${hoursLabel(t.minNoticeHours)} or more before`)
      : t.minNoticeHours === 0
        ? `Less than ${hoursLabel(upper)} before`
        : `${hoursLabel(t.minNoticeHours)} to ${hoursLabel(upper)} before`;
    const back = t.refundPct === 100 ? 'your deposit back in full'
      : t.refundPct === 0 ? 'no refund'
      : depositMinor ? `${pounds(Math.round((depositMinor * t.refundPct) / 100))} back (${t.refundPct}%)`
      : `${t.refundPct}% of your deposit back`;
    return `${when}: ${back}`;
  });
}

/** The three numbers the editor offers, as a schedule. */
export function tiersFromForm(f: { fullHours: number; partialHours: number; partialPct: number }): RefundTier[] {
  const tiers: RefundTier[] = [{ minNoticeHours: f.fullHours, refundPct: 100 }];
  // A partial tier only exists if it gives something back for some notice.
  if (f.partialPct > 0 && f.partialHours > 0 && f.partialHours < f.fullHours) {
    tiers.push({ minNoticeHours: f.partialHours, refundPct: f.partialPct });
  }
  tiers.push({ minNoticeHours: 0, refundPct: 0 });
  return tiers;
}

/** A saved schedule, read back into the editor's three numbers. */
export function formFromTiers(tiers: RefundTier[] | null | undefined) {
  const t = validTiers(tiers) ?? DEFAULT_TIERS;
  const full = t.find((x) => x.refundPct === 100);
  const partial = t.find((x) => x.refundPct > 0 && x.refundPct < 100 && x.minNoticeHours > 0);
  return {
    fullHours: full?.minNoticeHours ?? 48,
    partialHours: partial?.minNoticeHours ?? 24,
    partialPct: partial?.refundPct ?? 0,
  };
}
