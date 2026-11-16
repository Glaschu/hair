import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth, getAuth, getReactNativePersistence, type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import Storage from 'expo-sqlite/kv-store';
import type { FirebaseConfig } from '../bookingLink';

/**
 * The one Firebase instance this app runs, shared by sign-in and the database.
 *
 * ONE, because the ID token that satisfies the security rules lives on the app
 * instance. Auth and Firestore on two different instances means Firestore
 * reads as nobody, and every request is denied with nothing to say why.
 *
 * SIGN-IN SURVIVES A RESTART. The JS SDK on React Native keeps its session in
 * memory unless given somewhere to put it, so without this she is signed out
 * every time the app is closed while the app goes on saying "Connected". The
 * store is expo-sqlite's key-value store: an AsyncStorage drop-in that is
 * already in the app, so this needs no new native module and no rebuild.
 *
 * A DIFFERENT PROJECT MEANS A NEW INSTANCE. Re-linking to another service must
 * not keep talking to the old one, so the old instance is deleted — not just
 * forgotten — before the new one is made.
 */

const NAME = 'iris';

export interface IrisFirebase {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let ready: { projectId: string; promise: Promise<IrisFirebase> } | null = null;
/** The last instance that finished starting, for the one synchronous caller. */
let started: IrisFirebase | null = null;

export function irisFirebase(config: FirebaseConfig): Promise<IrisFirebase> {
  if (ready?.projectId === config.projectId) return ready.promise;

  const previous = ready?.promise;
  const promise = (async () => {
    // Anything still starting finishes first, so two instances with the same
    // name are never being made at once.
    await previous?.catch(() => null);

    const existing = getApps().find((a) => a.name === NAME);
    if (existing && existing.options.projectId !== config.projectId) {
      started = null;
      await deleteApp(existing);
    }

    // Fast refresh can leave an instance for the right project behind. Reusing
    // it is correct; re-initialising auth on it throws, and getAuth returns the
    // one that was set up with persistence.
    const app = getApps().find((a) => a.name === NAME) ?? initializeApp(config, NAME);
    let auth: Auth;
    try {
      auth = initializeAuth(app, { persistence: getReactNativePersistence(Storage) });
    } catch {
      auth = getAuth(app);
    }
    started = { app, auth, db: getFirestore(app) };
    return started;
  })();

  ready = { projectId: config.projectId, promise };
  // A failed start must not be cached for ever.
  promise.catch(() => { if (ready?.promise === promise) ready = null; });
  return promise;
}

/** The signed-in user once the persisted session has loaded — null if there is none. */
export async function currentUser(config: FirebaseConfig) {
  const { auth } = await irisFirebase(config);
  // The stored session loads asynchronously. Reading currentUser before this
  // says "signed out" on every cold start.
  await auth.authStateReady();
  return auth.currentUser;
}

export function startedAuth(): Auth | null {
  return started?.auth ?? null;
}

/** Raised when a Firebase-backed call is made with nobody signed in. */
export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to your booking service first — Settings → Online booking → Your database.');
    this.name = 'NotSignedInError';
  }
}

/**
 * The bearer for the service's stylist routes on this deployment.
 *
 * The service checks it exactly the way the security rules do — a stylist
 * claim or an allowlisted uid — so the API never lets in anyone the database
 * would turn away.
 */
export async function idTokenFor(config: FirebaseConfig, forceRefresh = false): Promise<string> {
  const user = await currentUser(config);
  if (!user) throw new NotSignedInError();
  return user.getIdToken(forceRefresh);
}

/** Drops the instance entirely — sign-out and unlinking. */
export async function forgetFirebase(): Promise<void> {
  const pending = ready?.promise;
  ready = null;
  started = null;
  const handles = await pending?.catch(() => null);
  if (handles) await deleteApp(handles.app).catch(() => {});
}
