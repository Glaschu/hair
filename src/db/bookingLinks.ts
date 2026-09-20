import { eq, lt } from 'drizzle-orm';
import { db } from './index';
import * as schema from './schema';

/**
 * The only record of which client a booking link went to.
 *
 * The service holds an opaque `clientRef` and nothing else, so this table
 * is what turns an incoming booking back into a person. Kept local and
 * out of the sync payload — links expire in weeks and don't belong in a
 * file that travels.
 */

export interface SentLink {
  token: string;
  clientRef: string;
  clientId: string;
  serviceName: string;
  url: string;
  createdAt: number;
  expiresAt: number;
}

/** A reference that means nothing outside this device. */
export function newClientRef(): string {
  const bytes = new Uint8Array(16);
  // Provided by react-native-get-random-values, imported at app entry.
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function recordSentLink(link: SentLink): void {
  db.insert(schema.bookingLinks).values(link)
    .onConflictDoUpdate({ target: schema.bookingLinks.token, set: link })
    .run();
}

/** Which client a booking belongs to, or null if we've lost the mapping. */
export function clientIdForRef(clientRef: string): string | null {
  const row = db.select().from(schema.bookingLinks)
    .where(eq(schema.bookingLinks.clientRef, clientRef)).limit(1).all()[0];
  return row?.clientId ?? null;
}

/** Links still live for a client, newest first — so she can see and revoke them. */
export function activeLinksForClient(clientId: string): SentLink[] {
  return db.select().from(schema.bookingLinks)
    .where(eq(schema.bookingLinks.clientId, clientId)).all()
    .filter((l) => l.expiresAt > Date.now())
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function forgetLink(token: string): void {
  db.delete(schema.bookingLinks).where(eq(schema.bookingLinks.token, token)).run();
}

/** Tidies links that expired a while ago. Safe to call on launch. */
export function purgeExpiredLinks(olderThanDays = 30): void {
  const cutoff = Date.now() - olderThanDays * 86_400_000;
  db.delete(schema.bookingLinks).where(lt(schema.bookingLinks.expiresAt, cutoff)).run();
}
