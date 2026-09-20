import { Service } from './types';
import { fmt } from './utils';

/**
 * The text she sends with a link.
 *
 * Written here rather than typed each time so it's consistent, but it
 * lands in the share sheet as ordinary editable text — she can change any
 * of it before it goes.
 */
export function bookingInviteMessage(opts: {
  firstName?: string;
  studioName: string;
  service: Service;
  slotCount: number;
  url: string;
  depositPercent?: number;
}): string {
  const { firstName, studioName, service, slotCount, url, depositPercent } = opts;

  const greeting = firstName ? `Hi ${firstName} — ` : '';
  const times = slotCount === 1 ? 'a time' : `${slotCount} times`;
  const deposit = depositPercent
    ? ` It's ${fmt.currency(service.price)}, ${depositPercent}% up front to hold the chair.`
    : ` It's ${fmt.currency(service.price)}.`;

  return (
    `${greeting}here ${slotCount === 1 ? 'is' : 'are'} ${times} for ${service.name}, ` +
    `first come first served:\n\n${url}\n\n` +
    `${deposit.trim()}\n\n${studioName}`
  );
}

/** First name only — what a link greeting shows if it leaks. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}
