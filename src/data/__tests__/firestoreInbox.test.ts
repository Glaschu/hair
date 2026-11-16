import {
  firestoreInbox, toIncoming, UnversionedBookingError, type InboxDb,
} from '../firestoreInbox';
import { sealBooking, generateKeyPair } from '../sealedBox';

/**
 * The inbox on the Firebase deployment.
 *
 * Her device reads Firestore directly here — there is no endpoint in front of
 * it — so the rules are the only thing between a booking and the wrong person,
 * and the shape of the write is the only thing between a booking and being
 * stuck in the inbox forever.
 */

const keys = generateKeyPair();

const stored = (over: Record<string, any> = {}) => ({
  token: 'tok1',
  clientRef: 'ref-1',
  serviceName: 'Cut and blow dry',
  durationMins: 60,
  priceMinor: 4500,
  startsAt: Date.UTC(2026, 8, 26, 9, 0),
  endsAt: Date.UTC(2026, 8, 26, 10, 0),
  createdAt: Date.UTC(2026, 8, 20, 10, 0),
  status: 'confirmed',
  seenAt: null,
  version: 0,
  sealed: sealBooking({ name: 'Ada Bell', phone: '07700900123' }, keys.publicKey),
  ...over,
});

const fakeDb = (rows: { id: string; data: Record<string, any> }[] = []) => {
  const calls: { path: string; patch: Record<string, unknown> | null }[] = [];
  const db: InboxDb & { calls: typeof calls; wheres: any[] } = {
    calls,
    wheres: [],
    async query(_collection, wheres) { db.wheres = wheres; return rows; },
    async transact(path, patch) {
      const row = rows.find((r) => `bookings/${r.id}` === path);
      const out = patch(row?.data ?? {});
      calls.push({ path, patch: out });
      if (out) Object.assign(row!.data, out);
    },
  };
  return db;
};

describe('what it asks for', () => {
  it('asks for everything not yet acknowledged, and says what state each is in', async () => {
    // Cancellations come back through this inbox, so it cannot filter to
    // confirmed. Keeping unpaid bookings out of her diary is intake's job, and
    // it is tested there.
    const db = fakeDb([{ id: 'b1', data: stored({ status: 'cancelled' }) }]);
    const [b] = await firestoreInbox(db, keys.secretKey).fetchBookings();
    expect(db.wheres).toEqual([['seenAt', '==', null]]);
    expect(b.status).toBe('cancelled');
  });

  it('delivers a backlog oldest first', async () => {
    const db = fakeDb([
      { id: 'b2', data: stored({ createdAt: 200 }) },
      { id: 'b1', data: stored({ createdAt: 100 }) },
    ]);
    const out = await firestoreInbox(db, keys.secretKey).fetchBookings();
    expect(out.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('opens the envelope on this device', async () => {
    const db = fakeDb([{ id: 'b1', data: stored() }]);
    const [b] = await firestoreInbox(db, keys.secretKey).fetchBookings();
    expect(b.details).toEqual({ name: 'Ada Bell', phone: '07700900123' });
  });

  it('hands back an unopenable envelope rather than throwing', async () => {
    // Wrong key — a restore from a different backup. The booking still exists
    // and still has to reach her.
    const db = fakeDb([{ id: 'b1', data: stored() }]);
    const [b] = await firestoreInbox(db, generateKeyPair().secretKey).fetchBookings();
    expect(b.details).toBeNull();
    expect(b.id).toBe('b1');
  });
});

describe('a document that is not quite right', () => {
  it('survives a missing end time by using the duration', async () => {
    // An appointment with no end hides the next one in the day view.
    const b = toIncoming('b1', stored({ endsAt: undefined, durationMins: 90 }), keys.secretKey);
    expect(b.endsAt).toBe(new Date(Date.UTC(2026, 8, 26, 10, 30)).toISOString());
  });

  it('never throws on a half-written document', () => {
    expect(() => toIncoming('b1', {}, keys.secretKey)).not.toThrow();
  });
});

describe('clearing one from the inbox', () => {
  it('bumps the version, because the rules refuse an edit without one', async () => {
    const db = fakeDb([{ id: 'b1', data: stored({ version: 4 }) }]);
    await firestoreInbox(db, keys.secretKey).markBookingSeen('b1');
    expect(db.calls[0].patch).toMatchObject({ version: 5 });
    expect(db.calls[0].patch!.seenAt).toEqual(expect.any(Number));
  });

  it('writes nothing when her other device already cleared it', async () => {
    const db = fakeDb([{ id: 'b1', data: stored({ seenAt: 123 }) }]);
    await firestoreInbox(db, keys.secretKey).markBookingSeen('b1');
    expect(db.calls[0].patch).toBeNull();
  });

  it('says what is actually wrong with a booking that predates versions', async () => {
    // Otherwise this arrives as a bare permission denial with nothing in it to
    // act on. Proven against the real rules in firebase/rules.test.mjs.
    const db = fakeDb([{ id: 'b1', data: stored({ version: undefined }) }]);
    await expect(firestoreInbox(db, keys.secretKey).markBookingSeen('b1'))
      .rejects.toThrow(UnversionedBookingError);
  });
});

describe('a client cancelling between the fetch and the acknowledgement', () => {
  it('is not swallowed: the booking is left in the inbox to come back as cancelled', async () => {
    const row = { id: 'b1', data: stored() };
    const db = fakeDb([row]);
    const inbox = firestoreInbox(db, keys.secretKey);
    await inbox.fetchBookings();           // seen as confirmed
    row.data.status = 'cancelled';         // the client cancels; seenAt stays null
    await inbox.markBookingSeen('b1');
    expect(db.calls[0].patch).toBeNull();
    expect(row.data.seenAt).toBeNull();
  });
});
