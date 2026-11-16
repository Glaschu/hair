import { reconcileOne, breachingLiveness } from './payment.mjs';

/**
 * The sweep that makes the invariant true in practice rather than in principle.
 *
 * Webhooks are a delivery mechanism, and delivery mechanisms fail. This is the
 * backstop that does not depend on one: walk what Stripe actually has, compare
 * it to what we recorded, repair what drifted, and flag what must not be
 * repaired.
 *
 * It is the difference between "we handle webhooks correctly" and "we can prove
 * nothing was lost".
 */

/**
 * How far back every run looks, regardless of what the last one saw.
 *
 * NOT a high-water cursor. Stripe retries for about three days, so an event
 * that finally lands on day two would sit forever behind a cursor that had
 * already moved past its creation time. Re-scanning a rolling window and
 * leaning on idempotence costs a handful of API calls at her volume and cannot
 * skip anything.
 */
export const WINDOW_MS = 72 * 60 * 60 * 1000;

/** Writes per chunk, so one failure leaves a consistent prefix rather than a mess. */
export const CHUNK = 100;

/**
 * @param list     (since) => Promise<payment[]>   — what Stripe has
 * @param load     (bookingId) => Promise<row|null> — what we recorded
 * @param repair   (verdict) => Promise<void>       — the SAME idempotent confirm path
 * @param flag     (verdict) => Promise<void>       — needs a human
 */
export async function reconcile({
  list, load, repair, flag, now = Date.now(), window = WINDOW_MS, chunk = CHUNK,
}) {
  const report = {
    scanned: 0, ok: 0, repaired: 0, flagged: 0, ignored: 0,
    failures: [], discrepancies: 0, since: now - window,
  };

  const payments = await list(now - window);
  const pending = [];

  for (const payment of payments) {
    report.scanned++;
    let local = null;
    try {
      local = payment.bookingId ? await load(payment.bookingId) : null;
    } catch (err) {
      // A read that failed is not a payment that matched. Counting it as `ok`
      // is how a reconciler reports zero discrepancies while something is
      // quietly broken.
      report.failures.push({ bookingId: payment.bookingId, error: String(err?.message ?? err) });
      continue;
    }

    const verdict = reconcileOne({ stripe: payment, local, now });
    if (verdict.action === 'ok') { report.ok++; continue; }
    if (verdict.action === 'ignore') { report.ignored++; continue; }
    pending.push({ verdict, payment });
  }

  // Chunked, and each chunk independently idempotent — a chunk failing halfway
  // leaves a consistent prefix and the next run picks up the rest.
  for (let i = 0; i < pending.length; i += chunk) {
    for (const { verdict, payment } of pending.slice(i, i + chunk)) {
      try {
        if (verdict.action === 'repair') {
          // Deliberately the same code path the webhook uses. A second repair
          // implementation is a second set of bugs, and they would only ever
          // disagree about money.
          await repair({ ...verdict, payment });
          report.repaired++;
        } else {
          await flag({ ...verdict, payment });
          report.flagged++;
        }
      } catch (err) {
        report.failures.push({ bookingId: verdict.bookingId, error: String(err?.message ?? err) });
      }
    }
  }

  // What the report is FOR. Anything that was not already correct is a
  // discrepancy — including the ones we fixed, because a run that repairs
  // twenty bookings every day is telling you something is broken upstream.
  report.discrepancies = report.repaired + report.flagged + report.failures.length;
  report.clean = report.discrepancies === 0;
  return report;
}

/**
 * The other half: payments nobody has resolved, which no amount of comparing
 * against Stripe will surface because Stripe thinks they are fine.
 */
export async function overdue({ loadUnresolved, now = Date.now() }) {
  return breachingLiveness(await loadUnresolved(), now);
}

/**
 * What she is shown. Silence when everything is fine; plain words when it is not.
 *
 * A report that always says something becomes a report nobody reads, and a
 * reconciler nobody reads is not a backstop.
 */
export function summarise(report) {
  if (report.clean) return null;

  const bits = [];
  if (report.repaired) bits.push(`${report.repaired} booking${report.repaired === 1 ? '' : 's'} put right`);
  if (report.flagged) bits.push(`${report.flagged} need${report.flagged === 1 ? 's' : ''} a look`);
  if (report.failures.length) bits.push(`${report.failures.length} couldn't be checked`);
  return bits.join(', ');
}
