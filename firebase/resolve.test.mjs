import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, applied, liveIntervals, overlaps, elapsedMs,
  MAX_ELAPSED_MS, MAX_VERSION_DRIFT,
} from './src/resolve.mjs';

/**
 * The resolver decides what a queued offline write does to the calendar. It runs
 * with admin privileges, so nothing else checks it — these tests are the only
 * thing that does.
 *
 * No emulator needed: the decision is pure, so every case runs in milliseconds
 * and the awkward ones can be constructed exactly rather than approximated.
 */

const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);
const h = (n) => n * 3_600_000;

/** An intent that would apply cleanly, unless a test spoils it. */
const intent = (over = {}) => ({
  id: 'i1',
  op: 'book',
  target: { s: NOW + h(26), e: NOW + h(28) },
  basisVersion: 41,
  clientMadeAt: NOW - h(1),
  serverReceivedAt: NOW,
  result: null,
  ...over,
});

const day = (over = {}) => ({ version: 41, intervals: [], ...over });

const appt = (id, startH, endH, extra = {}) =>
  ({ id, s: NOW + h(startH), e: NOW + h(endH), kind: 'appointment', ...extra });

const hold = (id, startH, endH, expiresAt) =>
  ({ id, s: NOW + h(startH), e: NOW + h(endH), kind: 'hold', expiresAt });

describe('overlap is about intervals, not identity', () => {
  test('a different service at an overlapping hour still clashes', () => {
    // The bug this replaces: claiming a slot by document id guarantees one hold
    // per id, and says nothing about a 90-minute colour running into a cut.
    const d = day({ intervals: [appt('a', 26, 28)] });
    const out = decide({ intent: intent({ target: { s: NOW + h(27), e: NOW + h(29) } }), day: d, now: NOW });
    assert.equal(out.action, 'reject');
    assert.equal(out.reason, 'conflict');
    assert.equal(out.conflictWith, 'a');
  });

  test('back-to-back is not a clash', () => {
    const d = day({ intervals: [appt('a', 24, 26)] });
    const out = decide({ intent: intent(), day: d, now: NOW });
    assert.equal(out.action, 'apply');
  });

  test('touching at both edges is fine, containment is not', () => {
    assert.equal(overlaps({ s: 0, e: 10 }, { s: 10, e: 20 }), false);
    assert.equal(overlaps({ s: 10, e: 20 }, { s: 0, e: 10 }), false);
    assert.equal(overlaps({ s: 5, e: 6 }, { s: 0, e: 10 }), true);
    assert.equal(overlaps({ s: 0, e: 10 }, { s: 5, e: 6 }), true);
  });

  test('her own manual appointments occupy the chair too', () => {
    // If occupancy came only from online holds, the booking page would sell the
    // hour she blocked out for the school run.
    const d = day({ intervals: [appt('school-run', 26, 27, { origin: 'manual' })] });
    assert.equal(decide({ intent: intent(), day: d, now: NOW }).action, 'reject');
  });
});

describe('expiry is read at read time, so a sweeper outage cannot block bookings', () => {
  test('an expired hold is free even if nothing has swept it', () => {
    const d = day({ intervals: [hold('h1', 26, 28, NOW - 1)] });
    assert.equal(liveIntervals(d, NOW).length, 0);
    assert.equal(decide({ intent: intent(), day: d, now: NOW }).action, 'apply');
  });

  test('a live hold still blocks', () => {
    const d = day({ intervals: [hold('h1', 26, 28, NOW + h(1))] });
    assert.equal(decide({ intent: intent(), day: d, now: NOW }).action, 'reject');
  });

  test('a hold with no expiry is treated as live, not as rubbish', () => {
    const d = day({ intervals: [hold('h1', 26, 28, undefined)] });
    assert.equal(decide({ intent: intent(), day: d, now: NOW }).action, 'reject');
  });
});

describe('a dead booking cannot be brought back', () => {
  // The counterexample that broke the claim "a replayed offline write physically
  // cannot resurrect a cancelled booking". Rules protect one field on one
  // document; this is what actually protects the calendar.
  const offlineNudge = intent({
    bookingId: 'b1',
    op: 'move',
    clientMadeAt: NOW - h(4),
    serverReceivedAt: NOW,
  });

  for (const status of ['cancelled', 'refunded', 'reversed', 'no_show', 'expired']) {
    test(`a ${status} booking stays dead, even with the hour now free`, () => {
      // Free precisely BECAUSE it was cancelled — so the conflict test passes,
      // the staleness test passes, and the time is still in the future. Every
      // other check waves this through.
      const out = decide({
        intent: offlineNudge,
        day: day({ intervals: [] }),
        booking: { id: 'b1', status },
        now: NOW,
      });
      assert.equal(out.action, 'reject');
      assert.equal(out.reason, `booking_${status}`);
    });
  }

  test('a live booking is still movable', () => {
    const out = decide({
      intent: offlineNudge,
      day: day({ intervals: [appt('b1', 26, 28)] }),
      booking: { id: 'b1', status: 'confirmed' },
      now: NOW,
    });
    assert.equal(out.action, 'apply', 'it must not clash with itself');
  });

  test('an intent about a booking that has vanished is refused, not applied', () => {
    const out = decide({ intent: offlineNudge, day: day(), booking: null, now: NOW });
    assert.equal(out.action, 'reject');
    assert.equal(out.reason, 'booking_missing');
  });

  test('the status check runs before the conflict check', () => {
    // Ordering is the whole fix. If conflict ran first, a cancelled booking
    // whose hour was since taken would be reported as a clash — which reads as
    // "someone beat you to it" rather than "that booking is gone".
    const out = decide({
      intent: offlineNudge,
      day: day({ intervals: [appt('other', 26, 28)] }),
      booking: { id: 'b1', status: 'cancelled' },
      now: NOW,
    });
    assert.equal(out.reason, 'booking_cancelled');
  });
});

describe('a device that has been dark too long is not trusted silently', () => {
  test('a stale intent goes to review even with no conflict', () => {
    const out = decide({
      intent: intent({ clientMadeAt: NOW - h(72), serverReceivedAt: NOW }),
      day: day(), now: NOW,
    });
    assert.equal(out.action, 'review');
    assert.equal(out.reason, 'stale_elapsed');
  });

  test('just inside the window still applies', () => {
    const out = decide({
      intent: intent({ clientMadeAt: NOW - MAX_ELAPSED_MS + 1000, serverReceivedAt: NOW }),
      day: day(), now: NOW,
    });
    assert.equal(out.action, 'apply');
  });

  test('a long version drift is stale even if the clock says it is fresh', () => {
    const out = decide({
      intent: intent({ basisVersion: 1 }),
      day: day({ version: 1 + MAX_VERSION_DRIFT + 1 }),
      now: NOW,
    });
    assert.equal(out.action, 'review');
    assert.equal(out.reason, 'stale_version');
  });

  test('a device clock set to the future cannot make an old intent look fresh', () => {
    // clientMadeAt after serverReceivedAt means elapsed is meaningless. Falling
    // back to version drift matters because drift comes from data the device
    // read off the server and cannot forge forwards.
    assert.equal(elapsedMs(intent({ clientMadeAt: NOW + h(48), serverReceivedAt: NOW })), null);

    const out = decide({
      intent: intent({ clientMadeAt: NOW + h(48), serverReceivedAt: NOW, basisVersion: 1 }),
      day: day({ version: 99 }),
      now: NOW,
    });
    assert.equal(out.action, 'review');
    assert.equal(out.reason, 'stale_version_skewed_clock');
  });

  test('a skewed clock with a current view is still applied', () => {
    // A wrong clock alone is not evidence of staleness, and refusing her work
    // because her iPad thinks it is Tuesday would be its own kind of loss.
    const out = decide({
      intent: intent({ clientMadeAt: NOW + h(48), serverReceivedAt: NOW, basisVersion: 41 }),
      day: day({ version: 41 }),
      now: NOW,
    });
    assert.equal(out.action, 'apply');
  });
});

describe('the awkward cases', () => {
  test('an already-resolved intent is never re-decided', () => {
    // Firestore triggers are at-least-once, so this is routine, not exotic.
    const out = decide({ intent: intent({ result: 'rejected' }), day: day(), now: NOW });
    assert.equal(out.action, 'noop');
    assert.equal(out.reason, 'already_resolved');
  });

  test('a target in the past goes to review rather than being dropped', () => {
    const out = decide({
      intent: intent({ target: { s: NOW - h(4), e: NOW - h(2) } }),
      day: day(), now: NOW,
    });
    assert.equal(out.action, 'review');
    assert.equal(out.reason, 'target_in_past');
  });

  test('a backwards or zero-length interval is refused', () => {
    for (const target of [{ s: NOW + h(4), e: NOW + h(2) }, { s: NOW + h(4), e: NOW + h(4) }]) {
      assert.equal(decide({ intent: intent({ target }), day: day(), now: NOW }).reason, 'malformed_target');
    }
  });

  test('an empty day accepts the first booking of the morning', () => {
    assert.equal(decide({ intent: intent(), day: undefined, now: NOW }).action, 'apply');
  });
});

describe('applying an intent', () => {
  test('bumps the version, so a stale writer loses the compare-and-swap', () => {
    const next = applied(day({ version: 41 }), intent(), NOW);
    assert.equal(next.version, 42);
  });

  test('is idempotent — re-applying does not double-book', () => {
    const i = intent({ bookingId: 'b1' });
    const once = applied(day(), i, NOW);
    const twice = applied(once, i, NOW);
    assert.equal(twice.intervals.length, 1);
    assert.equal(twice.version, 43, 'but it is still a new version each time');
  });

  test('drops expired holds as it goes, so the array does not grow forever', () => {
    const d = day({ intervals: [hold('old', 2, 3, NOW - 1), appt('keep', 40, 41)] });
    const next = applied(d, intent(), NOW);
    assert.deepEqual(next.intervals.map((i) => i.id), ['i1', 'keep']);
  });

  test('a cancel removes the interval and adds nothing', () => {
    const d = day({ intervals: [appt('b1', 26, 28)] });
    const next = applied(d, intent({ op: 'cancel', bookingId: 'b1' }), NOW);
    assert.equal(next.intervals.length, 0);
  });

  test('intervals stay sorted, so the array reads like a day', () => {
    const d = day({ intervals: [appt('late', 30, 31), appt('early', 20, 21)] });
    const next = applied(d, intent(), NOW);
    assert.deepEqual(next.intervals.map((i) => i.id), ['early', 'i1', 'late']);
  });

  test('never mutates the day it was given', () => {
    // The transaction body re-runs on contention. A function that mutated its
    // input would accumulate edits from attempts that were thrown away.
    const d = day({ intervals: [appt('a', 40, 41)] });
    const before = JSON.stringify(d);
    applied(d, intent(), NOW);
    assert.equal(JSON.stringify(d), before);
  });
});

describe('the whole hazard, end to end', () => {
  test('offline booking versus a paid online booking for the same hour', () => {
    // Saturday, no signal at the basin. She books Mrs Kerr into 11:00 next week.
    const hers = intent({
      id: 'mrs-kerr', target: { s: NOW + h(26), e: NOW + h(28) },
      clientMadeAt: NOW - h(4), serverReceivedAt: NOW, basisVersion: 41,
    });

    // Twenty minutes later the booking page sells an overlapping slot, with a
    // deposit, and the day document moves on.
    const after = day({
      version: 42,
      intervals: [appt('paid', 26.5, 28.5, { origin: 'online_deposit' })],
    });

    const out = decide({ intent: hers, day: after, now: NOW });
    assert.equal(out.action, 'reject');
    assert.equal(out.reason, 'conflict');
    assert.equal(out.conflictWith, 'paid', 'she is told exactly what took it');

    // And the paid booking is untouched — which is the point. Her write loses
    // loudly, as a conflict card, rather than winning silently over someone
    // holding a receipt.
    assert.equal(after.intervals.length, 1);
    assert.equal(after.version, 42);
  });
});
