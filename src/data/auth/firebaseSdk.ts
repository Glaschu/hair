import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as fbSignOut,
} from 'firebase/auth';
import type { FirebaseConfig } from '../bookingLink';
import type { AuthSdk } from './index';
import { irisFirebase, currentUser, startedAuth, forgetFirebase } from './firebaseApp';

/**
 * The real Firebase Auth, behind the narrow interface the app actually uses.
 *
 * Initialised lazily and from a config that arrived in her setup code, because
 * self-hosting means every stylist has her own project and there is nothing to
 * bake in. Nothing here runs unless she has a Firestore deployment — an app on
 * the Cloudflare version never touches Firebase at all.
 *
 * The session itself is kept by Firebase, persisted across restarts (see
 * firebaseApp.ts). Her password is never stored by this app.
 */
export function firebaseAuthSdk(config: FirebaseConfig): AuthSdk {
  return {
    async signIn(email, password) {
      const { auth } = await irisFirebase(config);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return { uid: cred.user.uid };
    },

    async createAccount(email, password) {
      const { auth } = await irisFirebase(config);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return { uid: cred.user.uid };
    },

    async signOut() {
      const { auth } = await irisFirebase(config);
      await fbSignOut(auth);
      await forgetFirebase();
    },

    /**
     * Forces a new ID token.
     *
     * This is the whole reason the "check again" button exists: permission
     * lives in the token, and a token minted before her uid reached the
     * allowlist carries none of it. Without the `true`, Firebase hands back the
     * cached one and nothing appears to change.
     */
    async refresh() {
      const user = await currentUser(config);
      if (user) await user.getIdToken(true);
    },

    currentUid() {
      return startedAuth()?.currentUser?.uid ?? null;
    },
  };
}
