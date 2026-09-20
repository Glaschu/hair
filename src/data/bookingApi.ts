import { BookingCredentials } from './bookingLink';
import { unsealBooking, SealedBooking } from './sealedBox';

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
  price: number;
  startsAt: string;
  endsAt: string;
  createdAt: number;
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
      authorization: `Bearer ${creds.deviceKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Say what she can act on, not what the server said.
    if (res.status === 401) throw new Error('This device is no longer linked. Set it up again.');
    if (res.status >= 500) throw new Error('The booking service is having trouble. Try again shortly.');
    throw new Error("That didn't go through. Check your connection and try again.");
  }
  return (await res.json()) as T;
}

/**
 * Asks a service what it is before trusting it. Also the first real
 * network call, so it doubles as "is this address even a booking service".
 */
export async function checkService(serviceUrl: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(`${serviceUrl}/api/version`);
  } catch {
    throw new Error("Couldn't reach that address. Check it and try again.");
  }
  if (!res.ok) throw new Error("That address doesn't look like a booking service.");

  const body = (await res.json()) as { service?: string; api?: number };
  if (body?.service !== 'iris-booking' || typeof body.api !== 'number') {
    throw new Error("That address doesn't look like a booking service.");
  }
  if (body.api !== APP_API_VERSION) throw new ServiceVersionError(body.api);
  return body.api;
}

/** The salon already registered here, or null if this service is fresh. */
export async function fetchSalon(
  creds: BookingCredentials,
): Promise<{ name: string; publicKey: string } | null> {
  const res = await fetch(`${creds.serviceUrl}/api/salon`, {
    headers: { authorization: `Bearer ${creds.deviceKey}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('That device key does not match this service.');
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
): Promise<void> {
  const res = await fetch(`${creds.serviceUrl}/api/salon`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${creds.deviceKey}`,
      ...(resetKey ? { 'x-iris-reset': resetKey } : {}),
    },
    body: JSON.stringify({
      name,
      publicKey: creds.keyPair.publicKey,
      policy: policy ?? DEFAULT_CANCELLATION_POLICY,
    }),
  });

  if (res.status === 409) {
    throw new SalonAlreadySetUpError();
  }
  if (res.status === 401) throw new Error('This device is no longer linked. Set it up again.');
  if (!res.ok) throw new Error("That didn't go through. Check your connection and try again.");
}

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
    durationMins: number; price: number; slots: LinkSlot[];
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
    price: Number(b.price ?? 0),
    startsAt: String(b.startsAt),
    endsAt: String(b.endsAt),
    createdAt: Number(b.createdAt ?? Date.now()),
    details: unsealBooking(String(b.sealed ?? ''), creds.keyPair.secretKey),
  }));
}

/** Marks one imported so it stops coming back. */
export function markBookingSeen(creds: BookingCredentials, id: string): Promise<{ ok: true }> {
  return call(creds, `/api/bookings/${id}/seen`, { method: 'POST' });
}
