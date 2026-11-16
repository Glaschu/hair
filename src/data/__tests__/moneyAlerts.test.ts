import { explainAlert, alertHeadline } from '../moneyAlerts';
import type { MoneyAlert } from '../bookingApi';

/**
 * Money that needs her, said so she knows what happened and where to fix it —
 * which is never in this app, always in Stripe or by hand.
 */

const alert = (over: Partial<MoneyAlert> = {}): MoneyAlert => ({
  id: 'booking~b1', kind: 'disputed', bookingId: 'b1', serviceName: 'Colour',
  startsAt: null, amountMinor: 4500, at: 1, detail: null, ...over,
});

it('names the client from her own diary — the service never knows names', () => {
  expect(explainAlert(alert(), 'Ada Bell').title).toBe('Ada Bell disputed their £45 deposit');
  expect(explainAlert(alert(), null).title).toBe('a client disputed their £45 deposit');
});

it('every kind says where to go to fix it', () => {
  for (const kind of ['disputed', 'refund_failed', 'refund_stuck', 'held_for_review', 'payment_without_booking'] as const) {
    const { todo } = explainAlert(alert({ kind }), 'Ada');
    expect(todo).toMatch(/Stripe|cash|bank transfer/);
    expect(alertHeadline(kind)).not.toBe('A payment needs a look');
  }
});

it('a refund Stripe refused shows Stripe’s own reason', () => {
  const { body } = explainAlert(alert({ kind: 'refund_stuck', amountMinor: 2250, detail: 'No such payment_intent' }), 'Ada');
  expect(body).toBe('Stripe said: No such payment_intent');
  expect(explainAlert(alert({ kind: 'refund_stuck', amountMinor: 2250 }), 'Ada').title).toBe('£22.50 refund to Ada couldn’t be sent'.replace('’', "'"));
});
