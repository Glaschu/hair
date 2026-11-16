import type { IncomingBooking } from './bookingApi';
import { unsealBooking } from './sealedBox';

/**
 * The inbox, on the Firebase deployment.
 *
 * On the Cloudflare version her device asks the Worker for what is waiting. On
 * this one there is no such endpoint on purpose — she reads Firestore directly
 * under the security rules, so there is no second authenticated API surface to
 * keep in step with the first. Only the PUBLIC booking routes are Functions.
 *
 * What comes out is exactly `IncomingBooking`, the same shape the Worker
 * produces, so `intake` never learns which deployment it is running on. That is
 * the whole point of the seam: a third backend should cost this one file.
 *
 * The envelope is opened HERE, on her device. The service stores a sealed blob
 * it cannot read, and that stays true whoever is hosting it.
 */

/** The narrow bit of Firestore this needs — injected so the logic is testable. */
export interface InboxDb {
  query(collection: string, wheres: [string, string, unknown][]): Promise<
    { id: string; data: Record<string, any> }[]
  >;
  /**
   * Read-modify-write on one document. Returning null from `patch` writes
   * nothing — the document was already how we wanted it.
   *
   * It has to be read-modify-write rather than a blind patch because the rules
   * enforce compare-and-swap: every edit of hers must carry `version + 1`, and
   * the current version is only knowable by reading.
   */
  transact(
    path: string,
    patch: (current: Record<string, any>) => Record<string, unknown> | null,
  ): Promise<void>;
}

/**
 * A booking written before bookings carried versions.
 *
 * Named rather than left as a permission error because the two need completely
 * different things said: this one is not "you are not allowed", it is "this
 * document predates the rule and needs backfilling".
 */
export class UnversionedBookingError extends Error {
  constructor(readonly bookingId: string) {
    super('This booking was created by an older version of the service and cannot be cleared.');
    this.name = 'UnversionedBookingError';
  }
}

export interface Inbox {
  fetchBookings(): Promise<IncomingBooking[]>;
  markBookingSeen(id: string): Promise<unknown>;
}

/**
 * Turns a stored booking into the shape the app works in.
 *
 * Every field is coerced rather than trusted. The documents are written by a
 * Cloud Function, but a half-written or older-schema document must degrade to a
 * booking that looks odd — never to a crash in her diary on a Saturday morning.
 */
export function toIncoming(id: string, b: Record<string, any>, secretKey: string): IncomingBooking {
  const iso = (v: unknown, fallback: number) =>
    new Date(typeof v === 'number' ? v : fallback).toISOString();
  const startsAt = iso(b.startsAt, Date.now());
  return {
    id,
    token: String(b.token ?? ''),
    clientRef: String(b.clientRef ?? ''),
    serviceName: String(b.serviceName ?? ''),
    durationMins: Number(b.durationMins ?? 60),
    priceMinor: Number(b.priceMinor ?? 0),
    startsAt,
    // An appointment with no end is an appointment that hides the next one, so
    // fall back to the duration rather than leaving it empty.
    endsAt: typeof b.endsAt === 'number'
      ? new Date(b.endsAt).toISOString()
      : new Date(Date.parse(startsAt) + Number(b.durationMins ?? 60) * 60_000).toISOString(),
    createdAt: Number.isFinite(Number(b.createdAt)) ? Number(b.createdAt) : Date.now(),
    status: typeof b.status === 'string' ? b.status : undefined,
    details: unsealBooking(String(b.sealed ?? ''), secretKey),
  };
}

export function firestoreInbox(db: InboxDb, secretKey: string): Inbox {
  /** The status each booking had when this device last fetched it. */
  const fetchedAs = new Map<string, string | undefined>();
  return {
    /**
     * What is waiting: everything not yet acknowledged, whatever its status.
     *
     * Not only confirmed bookings, because a client cancelling from their link
     * puts the booking back in this inbox as `cancelled` — that is how her
     * diary hears about it. `intake` decides what each status means: a
     * `pending_payment` booking (a Checkout still open, no money behind it) is
     * never put in her diary and never acknowledged, so it comes back once it
     * is paid.
     */
    async fetchBookings() {
      const rows = await db.query('bookings', [
        ['seenAt', '==', null],
      ]);
      rows.forEach((r) => fetchedAs.set(r.id, typeof r.data.status === 'string' ? r.data.status : undefined));
      return rows
        .map((r) => toIncoming(r.id, r.data, secretKey))
        // Oldest first, so a long backlog arrives in the order it was booked.
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Clears one from the inbox.
     *
     * The version bump is not bookkeeping — the rules REFUSE an edit without
     * one, so a write that forgets it fails as a flat permission denial with
     * nothing to suggest why.
     */
    markBookingSeen(id: string) {
      return db.transact(`bookings/${id}`, (current) => {
        // Already cleared, most likely by her other device. Writing again would
        // burn a version for nothing and could lose a concurrent edit.
        if (current.seenAt) return null;
        // Changed since this device read it — the client cancelled in the
        // moment between. Acknowledging now would swallow the cancellation and
        // leave a live appointment in her diary; left alone, it comes back on
        // the next pull as cancelled.
        if (fetchedAs.has(id) && fetchedAs.get(id) !== current.status) return null;
        if (typeof current.version !== 'number') throw new UnversionedBookingError(id);
        return { seenAt: Date.now(), version: current.version + 1 };
      });
    },
  };
}
