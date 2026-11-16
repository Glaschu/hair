/**
 * What the app can do right now, and why it can't do the rest.
 *
 * The rule the whole three-mode design rests on: **the app branches on
 * capabilities, never on mode.** A screen asks `has('deposits')`, never
 * `mode === 'self-hosted'`. Get that wrong and every feature gets built three
 * times, and the fourth mode — whatever it turns out to be — costs a rewrite.
 *
 * Modes:
 *   in-app       her today. Local SQLite, iCloud between her devices, no server.
 *   self-hosted  her own backend, paired by QR from its own setup page.
 *   hosted       one multi-tenant service someone else operates.
 */

export type BackendMode = 'in-app' | 'self-hosted' | 'hosted';

export type Capability =
  /** Send a client a link they can book from. */
  | 'booking-links'
  /** Take a deposit when they book. */
  | 'deposits'
  /** Refund by policy, from either side. */
  | 'refunds'
  /** Message clients from the service rather than from her phone. */
  | 'server-messaging'
  /** Bookings arrive without opening the app. */
  | 'push'
  /** Her devices converge in real time rather than on a file. */
  | 'live-sync'
  /** The "nothing was lost" report. */
  | 'reconciliation'
  /** Survives losing every device. */
  | 'offsite-backup';

const IN_APP: Capability[] = [];

const SELF_HOSTED: Capability[] = [
  'booking-links', 'deposits', 'refunds', 'server-messaging',
  'push', 'live-sync', 'reconciliation', 'offsite-backup',
];

/**
 * Identical to self-hosted on purpose.
 *
 * If these two ever diverge it should be because of something real — a feature
 * the operator genuinely cannot offer — and not because the code drifted. A
 * test asserts they match, so divergence has to be deliberate.
 */
const HOSTED: Capability[] = [...SELF_HOSTED];

const BY_MODE: Record<BackendMode, readonly Capability[]> = {
  'in-app': IN_APP,
  'self-hosted': SELF_HOSTED,
  hosted: HOSTED,
};

export function capabilitiesFor(mode: BackendMode): ReadonlySet<Capability> {
  return new Set(BY_MODE[mode] ?? IN_APP);
}

/**
 * What the app says when a feature isn't available here.
 *
 * Never hidden, never greyed out with no reason, never a paywall: the feature
 * appears in place, with one line of why and one thing to do about it. And the
 * reason is about *her setup*, not about our architecture — "needs a booking
 * service" means something to her; "capability not present in this mode" does
 * not.
 */
export interface Unavailable {
  why: string;
  action?: { label: string; route: string };
}

const REASONS: Partial<Record<Capability, Unavailable>> = {
  'booking-links': {
    why: 'Sending booking links needs a booking service. About 30 minutes to set up, then it runs itself.',
    action: { label: 'Set one up', route: 'BookingSetup' },
  },
  deposits: {
    why: 'Taking deposits needs a booking service and a Stripe account.',
    action: { label: 'Set one up', route: 'BookingSetup' },
  },
  refunds: {
    why: 'Refunds happen through the booking service that took the deposit.',
    action: { label: 'Set one up', route: 'BookingSetup' },
  },
  'server-messaging': {
    why: "Without a booking service, messages go from your phone — tap a client to text them.",
  },
  push: {
    why: 'Bookings arrive when you open the app. A booking service can notify you instead.',
    action: { label: 'Set one up', route: 'BookingSetup' },
  },
  'live-sync': {
    why: 'Your devices sync through iCloud, which can take a minute or two.',
  },
  reconciliation: {
    why: 'Nothing to reconcile without payments.',
  },
  'offsite-backup': {
    why: 'Your data is on this device and in iCloud. A booking service also keeps an encrypted copy.',
    action: { label: 'Set one up', route: 'BookingSetup' },
  },
};

export function whyUnavailable(capability: Capability): Unavailable {
  return REASONS[capability] ?? { why: 'Not available with your current setup.' };
}

/**
 * A capability her service *could* have but has not been given.
 *
 * Distinct from "not available here" because the answer is different: she has
 * the booking service already, and what is missing is her own Stripe account.
 * Telling her to set up a booking service she is already running would be
 * baffling.
 */
const NOT_CONNECTED: Partial<Record<Capability, Unavailable>> = {
  deposits: {
    why: 'Your booking service is running, but no Stripe account is connected to it yet. Deposits go straight to your own Stripe — nobody else handles the money.',
    action: { label: 'How to connect Stripe', route: 'BookingSetup' },
  },
  refunds: {
    why: 'Refunds need the Stripe account that took the deposit. Connect yours to start taking them.',
    action: { label: 'How to connect Stripe', route: 'BookingSetup' },
  },
};

export function notConnected(capability: Capability): Unavailable {
  return NOT_CONNECTED[capability]
    ?? { why: 'Your booking service does not have this switched on yet.' };
}

/**
 * What the app says when a capability it HAD goes away — she signs out, her
 * service is unreachable, Stripe onboarding lapses.
 *
 * This matters more for trust than the absent case. It names what is degraded
 * and what still works, and the app must never delete local data to match a
 * remote state that has gone quiet.
 */
export function degraded(capability: Capability): string {
  switch (capability) {
    case 'booking-links':
    case 'deposits':
    case 'refunds':
      return "Your booking page is unreachable. Everything in the app still works; new online bookings won't arrive until it's back.";
    case 'live-sync':
      return 'Your devices will catch up when the connection returns. Nothing is lost.';
    default:
      return 'Some online features are unavailable just now. Everything on this device still works.';
  }
}
