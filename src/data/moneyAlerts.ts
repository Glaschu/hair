import type { MoneyAlert } from './bookingApi';
import { depositMoney } from './policy';

/**
 * What each kind of money problem means, in her words, and what to do about
 * it. The service only knows amounts and booking ids; the client's name comes
 * from her own diary, so it is passed in.
 */

export function alertHeadline(kind: MoneyAlert['kind']): string {
  switch (kind) {
    case 'disputed': return 'A deposit has been disputed with the bank';
    case 'refund_failed': return "A refund didn't go through";
    case 'refund_stuck': return "A refund couldn't be sent";
    case 'held_for_review': return "A payment didn't match the deposit";
    case 'payment_without_booking': return 'A payment arrived with no booking';
    default: return 'A payment needs a look';
  }
}

const pounds = (minor: number | null) => (minor == null ? 'a payment' : depositMoney(minor));

export function explainAlert(
  alert: MoneyAlert,
  clientName: string | null,
): { title: string; body: string; todo: string } {
  const who = clientName ?? 'a client';
  const amount = pounds(alert.amountMinor);
  switch (alert.kind) {
    case 'disputed':
      return {
        title: `${who} disputed their ${amount} deposit`,
        body: 'Their bank has taken the money back while it decides. The appointment has not been changed.',
        todo: 'Respond in your Stripe dashboard under Payments → Disputes. There is a deadline, and evidence helps: your cancellation policy, and that they agreed to it when booking.',
      };
    case 'refund_failed':
      return {
        title: `${amount} refund to ${who} didn't go through`,
        body: 'Their bank turned the refund down, so they have not been paid back yet.',
        todo: 'Pay them back another way — cash or a bank transfer — or try again from your Stripe dashboard, then mark this as dealt with.',
      };
    case 'refund_stuck':
      return {
        title: `${amount} refund to ${who} couldn't be sent`,
        body: alert.detail ? `Stripe said: ${alert.detail}` : 'Stripe would not take the refund.',
        todo: 'Check the payment in your Stripe dashboard. If no refund is there, refund it from the payment page, then mark this as dealt with.',
      };
    case 'held_for_review':
      return {
        title: `A payment for ${who} didn't match`,
        body: `The amount paid didn't match the ${amount} deposit, so the booking was not confirmed.`,
        todo: 'Look at the payment in your Stripe dashboard. If it should not have been taken, refund it there.',
      };
    case 'payment_without_booking':
      return {
        title: `${amount} paid with no booking behind it`,
        body: 'Someone paid a deposit, but there is no booking for it on your service.',
        todo: 'Find the payment in your Stripe dashboard and refund it, or contact the client to book them in.',
      };
    default:
      return { title: alertHeadline(alert.kind), body: '', todo: 'Check your Stripe dashboard.' };
  }
}
