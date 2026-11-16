import type { BookingCredentials } from './bookingLink';
import { fetchBookings, markBookingSeen } from './bookingApi';
import { firestoreInbox, type Inbox, type InboxDb } from './firestoreInbox';
import { firestoreDb } from './firestoreDb';

/**
 * Which inbox this device is reading.
 *
 * The one place in the app that knows there are two deployments. Credentials
 * are the whole signal — the presence of a Firebase config is how the app knows
 * there is a Firestore to read; its absence means her service is the Worker and
 * bookings come over HTTP. No setting to drift out of step with reality.
 *
 * Everything downstream of here — `intake`, the screen, the diary — is
 * deployment-blind on purpose. A third backend should cost this function and
 * nothing else.
 */
export function inboxFor(
  credentials: BookingCredentials,
  /** Injected by tests; in the app it is built from the credentials. */
  firestore?: InboxDb,
): Inbox {
  if (credentials.firebase) {
    // Never fall through to HTTP here. The Firebase deployment exposes only the
    // PUBLIC booking routes as Functions — there is no /api/bookings to ask,
    // and falling back would 404 on every refresh with nothing to explain it.
    return firestoreInbox(
      firestore ?? firestoreDb(credentials.firebase),
      credentials.keyPair.secretKey,
    );
  }
  const fetchedAs = new Map<string, string | undefined>();
  return {
    async fetchBookings() {
      const bookings = await fetchBookings(credentials);
      bookings.forEach((b) => fetchedAs.set(b.id, b.status));
      return bookings;
    },
    markBookingSeen: (id) => markBookingSeen(credentials, id, fetchedAs.get(id)),
  };
}
