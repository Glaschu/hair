import { BookingCredentials } from './bookingLink';
import { unsealBooking, SealedBooking } from './sealedBox';
import { idTokenFor } from './auth/firebaseApp';
import type { RefundTier } from './policy';
import { ServiceError } from './serviceErrors';

/**
 * How her device proves it is hers, per deployment.
 *
 * Cloudflare: the device key from the setup code. Firebase: there is no device
 * key — she signs in, and the service checks her ID token exactly as the
 * security rules do. Sending the empty device key there was why every stylist
 * call on that deployment failed.
 */
async function authorization(creds: BookingCredentials): Promise<string> {
  if (creds.firebase) return `Bearer ${await idTokenFor(creds.firebase)}`;
  return `Bearer ${creds.deviceKey}`;
}

/** Said in words she can act on, and different per deployment — there is no device key to be "no longer linked" on Firebase. */
function refusal(creds: BookingCredentials, status: number): Error {
  if (creds.firebase) {
    return new ServiceError(status === 403
      ? "This device isn't allowed into your booking service yet. Settings → Online booking → Your database."
      : 'Sign in to your booking service again — Settings → Online booking → Your database.', 'refused');
  }
  return new ServiceError('This device is no longer linked. Set it up again.', 'refused');
}

/**
 * The service contract this build of iris speaks.
 *
 * Booking services are self-hosted, so they drift: someone deploys once
 * and updates the app a year later. Checking up front means we can say
 * which side needs updating instead of failing somewhere confusing.
 */
export const APP_API_VERSION = 1;

export class ServiceVersionError extends Error {
  constructor(readonly serviceVersion: number) {
    super(
      serviceVersion < APP_API_VERSION
        ? 'This booking service is older than the app. Deploy the latest version of it.'
        : 'This booking service is newer than the app. Update iris to use it.',
    );
    this.name = 'ServiceVersionError';
  }
}

/** A booking as it arrives: times in the clear, the person still sealed. */
export interface IncomingBooking {
  id: string;
  token: string;
  clientRef: string;
  serviceName: string;
  durationMins: number;
  priceMinor: number;
  startsAt: string;
  endsAt: string;
  createdAt: number;
  /**
   * Where the booking stands on the service: `confirmed`, `cancelled` (by the
   * client, from their link), or on the Firebase deployment `pending_payment`,
   * `expired` or `slot_lost`. Absent from older services, where it means
   * confirmed.
   */
  status?: string;
  /** Null when the envelope won't open — shown as needing attention, never dropped. */
  details: SealedBooking | null;
}

export interface LinkSlot {
  startsAt: string;
  endsAt: string;
}

async function call<T>(
  creds: BookingCredentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${creds.serviceUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: await authorization(creds),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Say what she can act on, not what the server said.
    if (res.status === 401 || res.status === 403) throw refusal(creds, res.status);
    if (res.status >= 500) throw new ServiceError('The booking service is having trouble. Try again shortly.', 'trouble');
    throw new Error("That didn't go through. Check your connection and try again.");
  }
  return (await res.json()) as T;
}

/**
 * Asks a service what it is before trusting it. Also the first real
 * network call, so it doubles as "is this address even a booking service".
 */
/**
 * What a deployment says it can do, for the capability seam.
 *
 * Separate from `checkService` because that one throws on a version mismatch —
 * right when linking, wrong here: a service one version behind still takes
 * bookings, and the app should keep working rather than going dark on a number.
 */
export async function probeService(
  creds: { serviceUrl: string },
): Promise<{ apiVersion: number; capabilities?: string[] }> {
  const res = await fetch(`${creds.serviceUrl}/api/version`);
  if (!res.ok) throw new Error('unreachable');
  const body = (await res.json()) as { api?: number; capabilities?: string[] };
  return { apiVersion: body.api ?? 0, capabilities: body.capabilities };
}

export async function checkService(serviceUrl: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(`${serviceUrl}/api/version`);
  } catch {
    throw new Error("Couldn't reach that address. Check it and try again.");
  }
  if (!res.ok) throw new Error("That address doesn't look like a booking service.");

  const body = (await res.json()) as { service?: string; api?: number; capabilities?: string[] };
  if (body?.service !== 'iris-booking' || typeof body.api !== 'number') {
    throw new Error("That address doesn't look like a booking service.");
  }
  if (body.api !== APP_API_VERSION) throw new ServiceVersionError(body.api);
  return body.api;
}

/** The salon already registered here, or null if this service is fresh. */
export async function fetchSalon(
  creds: BookingCredentials,
): Promise<{ name: string; publicKey: string; policy?: string | null; tiers?: RefundTier[] | null } | null> {
  const res = await fetch(`${creds.serviceUrl}/api/salon`, {
    headers: { authorization: await authorization(creds) },
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw creds.firebase ? refusal(creds, res.status) : new Error('That device key does not match this service.');
  }
  if (!res.ok) throw new Error("Couldn't read the service. Try again shortly.");
  return (await res.json()) as { name: string; publicKey: string };
}

/**
 * Registers her name and public key — the service can seal to her after
 * this. Registering the same key again is harmless; registering a
 * different one is refused unless `resetKey` is supplied, because that
 * would redirect every future booking.
 */
/**
 * The terms a client has to agree to before an online booking goes through.
 *
 * A default rather than a hardcoding: it is the policy Jessie already posts on
 * Instagram, so the service is useful out of the box, but every salon sets its
 * own notice period and charge and can edit this.
 */
export const DEFAULT_CANCELLATION_POLICY = [
  'If you need to cancel your appointment, please give at least 48 hours notice.',
  '',
  'Cancellations with less than 48 hours notice will be charged 50% of the remaining appointment cost. Cancellations less than 24 hours will need to pay the full amount.',
  '',
  'If you need to reschedule, please follow the same guidelines.',
].join('\n');

export async function registerSalon(
  creds: BookingCredentials,
  name: string,
  resetKey?: string,
  policy?: string,
  /** Her refund schedule. Only the Firebase service applies one — the free one takes no deposits. */
  tiers?: RefundTier[],
): Promise<void> {
  const res = await fetch(`${creds.serviceUrl}/api/salon`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: await authorization(creds),
      // Cloudflare: the reset key. Firebase: 'confirm', which the service only
      // honours alongside a fresh sign-in.
      ...(resetKey ? { 'x-iris-reset': resetKey } : {}),
    },
    // Only ever send a policy when one is being set. Passing the default here
    // meant every re-link and every reinstall silently reverted her edited
    // cancellation terms — and those terms are what a chargeback turns on.
    body: JSON.stringify({
      name,
      publicKey: creds.keyPair.publicKey,
      ...(policy === undefined ? {} : { policy }),
      ...(tiers === undefined ? {} : { tiers }),
    }),
  });

  if (res.status === 409) {
    throw new SalonAlreadySetUpError();
  }
  if (res.status === 401 || res.status === 403) throw refusal(creds, res.status);
  if (!res.ok) throw new Error("That didn't go through. Check your connection and try again.");
}

/**
 * Puts her cancellation terms on the service if it has none.
 *
 * Nothing ever sent them: the default was written and exported and never
 * passed to `registerSalon`, so every link was made without terms and no client
 * was ever asked to agree to the 48 hours. Set once, never over terms she has
 * already set — and called before a link is made, because a link pins the
 * terms in force at that moment.
 */
export async function ensurePolicy(creds: BookingCredentials): Promise<void> {
  // Once a service is known to have a policy it keeps one (it can be edited,
  // never removed), so the check is not repeated before every link.
  if (hasPolicy.has(creds.serviceUrl)) return;
  const salon = await fetchSalon(creds);
  if (!salon) return;
  if (!salon.policy) await registerSalon(creds, salon.name, undefined, DEFAULT_CANCELLATION_POLICY);
  hasPolicy.add(creds.serviceUrl);
}
const hasPolicy = new Set<string>();

/** Raised when a service already has a salon and the keys don't match. */
export class SalonAlreadySetUpError extends Error {
  constructor() {
    super(
      'This booking service already belongs to a salon. To add a device, scan the code ' +
      'inside the app on the one that already works. To start over instead, sign in to ' +
      'your service\'s setup page and choose "Start over on a new phone".',
    );
    this.name = 'SalonAlreadySetUpError';
  }
}

/**
 * Mints a link for one client.
 *
 * `clientRef` is deliberately a fresh random string rather than the
 * client's id: the service should never be able to tell that two links
 * belong to the same person. iris keeps the mapping.
 */
export function createLink(
  creds: BookingCredentials,
  link: {
    clientRef: string; greeting?: string; serviceName: string;
    durationMins: number; priceMinor: number; tz?: string; slots: LinkSlot[];
  },
): Promise<{ token: string; url: string; expiresAt: number }> {
  return call(creds, '/api/links', { method: 'POST', body: JSON.stringify(link) });
}

export function revokeLink(creds: BookingCredentials, token: string): Promise<{ ok: true }> {
  return call(creds, `/api/links/${token}`, { method: 'DELETE' });
}

/** Fetches what's waiting and opens each envelope on this device. */
export async function fetchBookings(creds: BookingCredentials): Promise<IncomingBooking[]> {
  const { bookings } = await call<{ bookings: any[] }>(creds, '/api/bookings');
  return bookings.map((b) => ({
    id: String(b.id),
    token: String(b.token),
    clientRef: String(b.clientRef),
    serviceName: String(b.serviceName ?? ''),
    durationMins: Number(b.durationMins ?? 60),
    priceMinor: Number(b.priceMinor ?? 0),
    startsAt: String(b.startsAt),
    endsAt: String(b.endsAt),
    createdAt: Number.isFinite(Number(b.createdAt)) ? Number(b.createdAt) : Date.now(),
    status: typeof b.status === 'string' ? b.status : undefined,
    details: unsealBooking(String(b.sealed ?? ''), creds.keyPair.secretKey),
  }));
}

/** Marks one imported so it stops coming back. */
export function markBookingSeen(creds: BookingCredentials, id: string, status?: string): Promise<{ ok: true }> {
  // The status this device saw goes with it: the service only acknowledges if
  // the booking is still in that state, so a cancellation landing in between
  // is not swallowed.
  return call(creds, `/api/bookings/${id}/seen`, {
    method: 'POST',
    ...(status ? { body: JSON.stringify({ status }) } : {}),
  });
}

/**
 * A request to one of her own routes, handing back the status rather than
 * throwing on it — for the calls where "this service has no such route" is an
 * answer, not a failure (the free Cloudflare service takes no deposits, so it
 * has no deposit preview and no money to warn about).
 */
async function ask(creds: BookingCredentials, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${creds.serviceUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: await authorization(creds),
      ...(init.headers ?? {}),
    },
  });
}

/** Saves her cancellation policy — words, and on a deposit-taking service the schedule. */
export async function savePolicy(
  creds: BookingCredentials,
  { policy, tiers }: { policy: string; tiers?: RefundTier[] },
): Promise<void> {
  const salon = await fetchSalon(creds);
  if (!salon) throw new Error('Set up your booking service first, then add your policy.');
  await registerSalon(creds, salon.name, undefined, policy, tiers);
}

export interface WebCancelPreview {
  status: string;
  /** The deposit still held — 0 for a free booking, or one already refunded or disputed. */
  depositMinor: number;
  noticeMs: number;
  /** What her schedule gives back at this notice, if the client asked to cancel. */
  policyRefundPct: number;
}

/** What cancelling a web booking would mean. Null where the service takes no deposits. */
export async function previewWebCancel(creds: BookingCredentials, bookingId: string): Promise<WebCancelPreview | null> {
  const res = await ask(creds, `/api/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'GET' });
  if (res.status === 404 || res.status === 405) return null;
  if (!res.ok) throw refusalOrTrouble(creds, res.status);
  return (await res.json()) as WebCancelPreview;
}

/**
 * Tells the service she has cancelled a web booking.
 *
 * Returns what to do with the queued request: `done` — the service has it (or
 * never knew the booking, so there is nothing to tell); `retry` — keep it and
 * try again, because signal, sign-in or a payment still going through can all
 * change.
 */
export async function cancelOnService(
  creds: BookingCredentials,
  item: { bookingId: string; refund: 'full' | 'policy'; cancelledAt: number },
): Promise<'done' | 'retry'> {
  let res: Response;
  try {
    res = await ask(creds, `/api/bookings/${encodeURIComponent(item.bookingId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ refund: item.refund, cancelledAt: item.cancelledAt }),
    });
  } catch {
    return 'retry';
  }
  // 404: this service has never heard of the booking (she has since linked a
  // different one), so there is nothing left to tell it. Everything else is
  // kept — a refusal now can be a yes after she signs in, or once a payment
  // still going through has landed.
  if (res.ok || res.status === 404) return 'done';
  return 'retry';
}

/** One piece of money that needs her. See firebase/src/attention.mjs. */
export interface MoneyAlert {
  id: string;
  kind: 'disputed' | 'refund_failed' | 'held_for_review' | 'refund_stuck' | 'payment_without_booking';
  bookingId: string;
  serviceName: string | null;
  startsAt: string | null;
  amountMinor: number | null;
  at: number | null;
  detail: string | null;
}

export async function fetchMoneyAlerts(creds: BookingCredentials): Promise<MoneyAlert[]> {
  const res = await ask(creds, '/api/attention', { method: 'GET' });
  if (res.status === 404 || res.status === 405) return [];
  if (!res.ok) throw refusalOrTrouble(creds, res.status);
  return ((await res.json()) as { items: MoneyAlert[] }).items;
}

export async function dismissMoneyAlert(creds: BookingCredentials, id: string): Promise<void> {
  const res = await ask(creds, `/api/attention/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  if (!res.ok && res.status !== 404) throw refusalOrTrouble(creds, res.status);
}

function refusalOrTrouble(creds: BookingCredentials, status: number): Error {
  if (status === 401 || status === 403) return refusal(creds, status);
  return new ServiceError("The booking service didn't answer properly. Try again shortly.", 'trouble');
}

/**
 * Her days off, sent whole — the service keeps them and refuses those days on
 * every path. `done` only once it has them. Anything else is tried again on the
 * next pull: a 404 can mean her salon is not set up there yet, and treating that
 * as done lost every day she blocked before finishing setup. A service too old
 * to know about days off costs one small request per pull, which is cheap.
 */
export async function putDaysOffOnService(
  creds: BookingCredentials,
  ranges: { from: string; to: string }[],
): Promise<'done' | 'retry'> {
  try {
    const res = await ask(creds, '/api/days-off', { method: 'PUT', body: JSON.stringify({ ranges }) });
    return res.ok ? 'done' : 'retry';
  } catch {
    return 'retry';
  }
}
