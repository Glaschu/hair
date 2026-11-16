import {
  collection, query, where, getDocs, getDocsFromServer, doc, runTransaction, limit,
} from 'firebase/firestore';
import type { FirebaseConfig } from './bookingLink';
import type { InboxDb } from './firestoreInbox';
import { irisFirebase, currentUser, NotSignedInError } from './auth/firebaseApp';

/**
 * The real Firestore, behind the two-method interface the inbox needs.
 *
 * Kept this narrow on purpose: the app should be able to drop Firebase
 * entirely — which is exactly what the free Cloudflare deployment does — and
 * the only thing that has to know is this file.
 *
 * On the same instance as sign-in (firebaseApp.ts), because that is where the
 * ID token lives. A second instance would read as nobody and be denied.
 */
export function firestoreDb(config: FirebaseConfig): InboxDb {
  /** Signed in, or say so plainly — a denial with nobody signed in reads as "no connection". */
  const signedIn = async () => {
    if (!(await currentUser(config))) throw new NotSignedInError();
    return (await irisFirebase(config)).db;
  };

  return {
    async query(collectionName, wheres) {
      const db = await signedIn();
      const q = query(
        collection(db, collectionName),
        ...wheres.map(([field, op, value]) => where(field, op as any, value)),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },

    /**
     * Read-modify-write in a real transaction.
     *
     * The rules enforce compare-and-swap, so the version this writes has to be
     * the version that was actually there. Reading outside a transaction and
     * writing after would lose to her other device and fail as a flat
     * permission denial.
     */
    async transact(path, patch) {
      const db = await signedIn();
      const ref = doc(db, path);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const next = patch(snap.data());
        if (next) tx.update(ref, next);
      });
    },
  };
}

/**
 * Has this device been let in? Asked of the database itself.
 *
 * A real read of the collection she needs, from the server — never the cache,
 * which would happily answer yes offline. Denied means no; anything else
 * (offline, the service down) is thrown, because "couldn't tell" must never be
 * shown to her as "you're not on the list".
 */
export async function probeAccess(config: FirebaseConfig): Promise<boolean> {
  if (!(await currentUser(config))) return false;
  const { db } = await irisFirebase(config);
  try {
    await getDocsFromServer(query(collection(db, 'bookings'), limit(1)));
    return true;
  } catch (e) {
    if ((e as { code?: string })?.code === 'permission-denied') return false;
    throw e;
  }
}
