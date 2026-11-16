import { inboxFor } from '../inboxFor';
import type { BookingCredentials } from '../bookingLink';
import type { InboxDb } from '../firestoreInbox';
import * as bookingApi from '../bookingApi';

jest.mock('../bookingApi', () => ({
  fetchBookings: jest.fn(async () => []),
  markBookingSeen: jest.fn(async () => ({ ok: true })),
}));
// Touching the real SDK would try to reach Google from a unit test.
jest.mock('../firestoreDb', () => ({
  firestoreDb: jest.fn(() => { throw new Error('built the real Firestore adapter'); }),
}));

/**
 * The one function in the app that knows there are two deployments.
 *
 * It matters more than its size: picking wrong does not fail loudly, it 404s on
 * every refresh, and the symptom she reports is "bookings never arrive".
 */

const creds = (over: Partial<BookingCredentials> = {}): BookingCredentials => ({
  serviceUrl: 'https://book.example',
  deviceKey: 'dk',
  keyPair: { publicKey: 'pk', secretKey: 'sk' },
  ...over,
});

const firestore: InboxDb = { query: async () => [], transact: async () => {} };

beforeEach(() => jest.clearAllMocks());

it('reads over HTTP when there is no Firestore to read', async () => {
  await inboxFor(creds()).fetchBookings();
  expect(bookingApi.fetchBookings).toHaveBeenCalled();
});

it('reads Firestore directly when the deployment has one', async () => {
  await inboxFor(creds({ firebase: { projectId: 'p', apiKey: 'k', appId: 'a' } as any }), firestore)
    .fetchBookings();
  expect(bookingApi.fetchBookings).not.toHaveBeenCalled();
});

it('never falls back to HTTP on a Firebase deployment', () => {
  // There is no /api/bookings on that deployment — only the public booking
  // routes are Functions. Falling through would 404 forever, silently.
  expect(() => inboxFor(creds({ firebase: { projectId: 'p' } as any })))
    .toThrow('built the real Firestore adapter');
  expect(bookingApi.fetchBookings).not.toHaveBeenCalled();
});

it('opens envelopes with her key, whichever deployment it is', async () => {
  const seen: unknown[] = [];
  const spy: InboxDb = { query: async (c, w) => { seen.push(w); return []; }, transact: async () => {} };
  await inboxFor(creds({ firebase: { projectId: 'p' } as any }), spy).fetchBookings();
  expect(seen[0]).toEqual([['seenAt', '==', null]]);
});
