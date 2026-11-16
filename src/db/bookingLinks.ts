import { eq, lt } from 'drizzle-orm';
import { db } from './index';
import * as schema from './schema';

/**
 * This device's record of the links it has sent.
 *
 * It used to be the ONLY record of which client a link went to, which meant a
 * booking pulled in on another device could not be matched back. The client is
 * now sealed into the link itself (data/clientRef.ts); this table remains for
 * links already out there and for showing her which links are live. Kept local
 * and out of the sync payload — links expire in weeks.
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

export function recordSentLink(link: SentLink): void {
  db.insert(schema.bookingLinks).values(link)
    .onConflictDoUpdate({ target: schema.bookingLinks.token, set: link })
    .run();
}

/**
 * Which client a booking belongs to, from this device's own record — for links
 * made before the client was sealed into the reference (see data/clientRef.ts).
 * New links do not need this, and it only ever knew links sent from here.
 */
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
