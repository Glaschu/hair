import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, overdue, summarise, WINDOW_MS } from './src/reconcile.mjs';

/**
 * The reconciler is what turns "we handle webhooks correctly" into "we can
 * prove nothing was lost". These tests are mostly about the ways a reconciler
 * lies: by skipping what it never looked at, by counting a failed check as a
 * match, and by reporting so much that nobody reads it.
 */

const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;

const paid = (over = {}) => ({
  bookingId: 'bk_1', paymentStatus: 'paid', amountMinor: 4500, currency: 'gbp',
  amountRefundedMinor: 0, disputed: false, refundFailed: false, ...over,
});

const local = (over = {}) => ({
  bookingId: 'bk_1', classification: 'confirmed', expectedAmountMinor: 4500,
  appointmentId: 'ap_1', updatedAt: NOW - h(1), ...over,
});

/** A run with everything stubbed, returning what happened. */
async function run({ payments = [], rows = {}, loadThrows = null } = {}) {
  const repaired = [];
  const flagged = [];
  const report = await reconcile({
    now: NOW,
    list: async () => payments,
    load: async (id) => {
      if (loadThrows && id === loadThrows) throw new Error('firestore unavailable');
      return rows[id] ?? null;
    },
    repair: async (v) => repaired.push(v),
    flag: async (v) => flagged.push(v),
  });
  return { report, repaired, flagged };
}

describe('a quiet day', () => {
  test('says nothing at all when everything matches', async () => {
    const { report } = await run({ payments: [paid()], rows: { bk_1: local() } });
    assert.equal(report.ok, 1);
    assert.equal(report.discrepancies, 0);
    assert.equal(report.clean, true);
    assert.equal(summarise(report), null, 'no news is no message');
  });

  test('an empty window is clean, not suspicious', async () => {
    const { report } = await run({});
    assert.equal(report.clean, true);
    assert.equal(report.scanned, 0);
  });
});

describe('what it puts right', () => {
  test('a paid deposit whose booking never confirmed', async () => {
    // Six hours of webhook outage. This is what gets them back.
    const { report, repaired } = await run({ payments: [paid()], rows: {} });
    assert.equal(report.repaired, 1);
    assert.equal(repaired[0].reason, 'succeeded_payment_with_no_booking');
    assert.equal(report.clean, false, 'fixed is still a discrepancy worth knowing about');
  });

  test('a booking that drifted out of step with Stripe', async () => {
    const { repaired } = await run({
      payments: [paid({ amountRefundedMinor: 4500 })],
      rows: { bk_1: local() },
    });
    assert.equal(repaired[0].to, 'refunded');
  });

  test('repairs go through the same path the webhook uses', async () => {
    // A second repair implementation is a second set of bugs, and they would
    // only ever disagree about money. The verdict carries the payment so the
    // caller has no excuse to re-derive anything.
    const { repaired } = await run({ payments: [paid()], rows: {} });
    assert.ok(repaired[0].payment, 'the fetched payment travels with the verdict');
    assert.equal(repaired[0].bookingId, 'bk_1');
  });
});

describe('what it refuses to put right', () => {
  test('a dispute is flagged, never repaired', async () => {
    // Repairing would re-confirm an appointment whose money has gone — papering
    // over the one case that most needs a human.
    const { report, repaired, flagged } = await run({
      payments: [paid({ disputed: true })],
      rows: { bk_1: local() },
    });
    assert.equal(repaired.length, 0);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].reason, 'disputed');
    assert.equal(report.clean, false);
  });
});

describe('the ways a reconciler lies', () => {
  test('a failed read is never counted as a match', async () => {
    // The worst outcome available: a green report while something is quietly
    // broken. A read that failed is not a payment that agreed.
    const { report } = await run({
      payments: [paid()], rows: { bk_1: local() }, loadThrows: 'bk_1',
    });
    assert.equal(report.ok, 0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.clean, false);
  });

  test('one broken read does not abandon the rest of the sweep', async () => {
    const { report } = await run({
      payments: [paid({ bookingId: 'bad' }), paid({ bookingId: 'good' })],
      rows: { good: local({ bookingId: 'good' }) },
      loadThrows: 'bad',
    });
    assert.equal(report.scanned, 2);
    assert.equal(report.ok, 1, 'the healthy one still got checked');
    assert.equal(report.failures.length, 1);
  });

  test('a repair that throws is recorded rather than swallowed', async () => {
    const report = await reconcile({
      now: NOW,
      list: async () => [paid()],
      load: async () => null,
      repair: async () => { throw new Error('write failed'); },
      flag: async () => {},
    });
    assert.equal(report.repaired, 0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.clean, false);
  });

  test('payments that were never ours do not make the report permanently red', async () => {
    // She has Tap to Pay and dashboard invoices. Counting those as discrepancies
    // means the report never reads clean, and a report that is always red is a
    // report nobody opens.
    const { report } = await run({ payments: [paid({ bookingId: null })] });
    assert.equal(report.ignored, 1);
    assert.equal(report.clean, true);
  });
});

describe('the window, not a cursor', () => {
  test('always looks back three days, whatever the last run saw', async () => {
    // A high-water cursor would skip an event that finally lands on day two,
    // because the cursor had already moved past its creation time — and that is
    // exactly the event a backstop exists for.
    let askedSince = null;
    await reconcile({
      now: NOW,
      list: async (since) => { askedSince = since; return []; },
      load: async () => null, repair: async () => {}, flag: async () => {},
    });
    assert.equal(askedSince, NOW - WINDOW_MS);
    assert.ok(WINDOW_MS >= 72 * h(1), 'at least as long as Stripe keeps retrying');
  });

  test('re-scanning the same window twice changes nothing', async () => {
    // Which is what makes a rolling window affordable: idempotence does the
    // work a cursor would have done, without the skipping.
    const payments = [paid()];
    const rows = { bk_1: local() };
    const first = await run({ payments, rows });
    const second = await run({ payments, rows });
    assert.deepEqual(
      { ok: first.report.ok, repaired: first.report.repaired },
      { ok: second.report.ok, repaired: second.report.repaired },
    );
  });
});

describe('chunking', () => {
  test('a large backlog is written in pieces, all of them', async () => {
    const payments = Array.from({ length: 250 }, (_, i) => paid({ bookingId: `bk_${i}` }));
    const { report, repaired } = await run({ payments, rows: {} });
    assert.equal(report.repaired, 250);
    assert.equal(new Set(repaired.map((r) => r.bookingId)).size, 250, 'none done twice');
  });
});

describe('what she is told', () => {
  test('nothing, when there is nothing to say', async () => {
    const { report } = await run({ payments: [paid()], rows: { bk_1: local() } });
    assert.equal(summarise(report), null);
  });

  test('plain words when there is', async () => {
    const { report } = await run({ payments: [paid()], rows: {} });
    assert.match(summarise(report), /1 booking put right/);
  });

  test('singular and plural both read like English', async () => {
    const one = await run({ payments: [paid()], rows: {} });
    const many = await run({
      payments: [paid({ bookingId: 'a' }), paid({ bookingId: 'b' })], rows: {},
    });
    assert.match(summarise(one.report), /1 booking put right/);
    assert.match(summarise(many.report), /2 bookings put right/);
  });
});

describe('payments nobody resolved', () => {
  test('surface even though Stripe thinks they are fine', async () => {
    // The other half of the invariant: comparing against Stripe will never find
    // these, because from Stripe's side nothing is wrong.
    const rows = [
      { bookingId: 'a', classification: 'held_for_review', updatedAt: NOW },
      { bookingId: 'b', classification: 'pending', updatedAt: NOW - h(48) },
      { bookingId: 'c', classification: 'confirmed', updatedAt: NOW - h(500) },
    ];
    const out = await overdue({ loadUnresolved: async () => rows, now: NOW });
    assert.deepEqual(out.map((r) => r.bookingId), ['a', 'b']);
  });
});
