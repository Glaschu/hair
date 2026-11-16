import { initializeApp, deleteApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * An Admin SDK handle pointed at the emulator.
 *
 * The point of this file: the wrappers under test are the ones that will ship.
 * They were written against the client SDK, which meant a green suite said
 * nothing about production — `snap.exists` is a property in the Admin SDK and a
 * method in the client one, and that difference alone would have thrown on the
 * first real request.
 *
 * `FIRESTORE_EMULATOR_HOST` is what makes the Admin SDK talk to the emulator
 * instead of a real project. Rules do not apply to it, which is correct and is
 * exactly why the resolver and the webhook handler need their own tests.
 */
export function testDb(projectId = 'iris-admin-test') {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  const app = getApps().find((a) => a.name === projectId)
    ?? initializeApp({ projectId }, projectId);
  return { db: getFirestore(app), FieldValue, app };
}

export async function wipe(db) {
  for (const name of ['intents', 'days', 'bookings', 'outbox',
                      'processedEvents', 'orphanPayments', 'links', 'policies']) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

export async function closeDb(app) {
  await deleteApp(app).catch(() => {});
}
