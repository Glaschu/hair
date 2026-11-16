import * as SecureStore from 'expo-secure-store';

/**
 * Signing in, so Firestore will talk to her at all.
 *
 * The rules want `request.auth` to exist with a uid that has been allowed in.
 * The *identity* barely matters here — it is one person with one salon — so the
 * job is narrow: get a stable uid, keep it across app launches, and surface it
 * so it can be pasted into the allowlist.
 *
 * WHY EMAIL AND PASSWORD, not the email link this was going to be.
 *
 * An email link is a URL that has to reopen the app, which needs a URL scheme
 * in app.json and therefore a native rebuild. This app has no scheme today.
 * Email and password reaches exactly the same place — a signed-in uid — with no
 * native change at all. The password is never stored by this app: Firebase
 * keeps the signed-in session itself, persisted across restarts (firebaseApp.ts),
 * so she types it once per device.
 *
 * The seam is built so `signInWithCustomToken` can replace it later without
 * touching a screen: the booking service already proves who she is with a
 * device key, and could mint a token from it. That is the nicer end state; it
 * needs a service-account key on the server side, which is a decision for when
 * the Firebase deployment is actually stood up.
 */

/** The minimum of Firebase Auth this app needs, so tests never touch a network. */
export interface AuthSdk {
  signIn(email: string, password: string): Promise<{ uid: string }>;
  createAccount(email: string, password: string): Promise<{ uid: string }>;
  signOut(): Promise<void>;
  /** Forces a token refresh, which is how a newly granted uid starts working. */
  refresh(): Promise<void>;
  currentUid(): string | null;
}

export interface Session {
  uid: string;
  email: string;
  /** True once Firestore has actually accepted a read with this token. */
  admitted: boolean;
}

const KEY = 'iris.auth.session';

/**
 * Kept in the keychain rather than AsyncStorage, which would be a new native
 * module and another rebuild. It is a credential; the keychain is where it
 * belongs anyway.
 */
const STORE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, STORE);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session), STORE);
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, STORE);
  } catch {
    // Already gone is the outcome we wanted.
  }
}

/** What the app shows her, and what it should do about it. */
export type AuthState =
  | { kind: 'signed-out' }
  /** Signed in, but her uid is not on the allowlist yet — the normal first run. */
  | { kind: 'waiting-for-access'; uid: string; email: string }
  | { kind: 'ready'; uid: string; email: string };

export function stateOf(session: Session | null): AuthState {
  if (!session) return { kind: 'signed-out' };
  return session.admitted
    ? { kind: 'ready', uid: session.uid, email: session.email }
    : { kind: 'waiting-for-access', uid: session.uid, email: session.email };
}

/**
 * Sign in, creating the account on first run.
 *
 * Self-hosting means nobody has made her an account, so "wrong password" and
 * "no account yet" are the same click. Creating on a failed sign-in rather than
 * the other way round means an existing account is never at risk of a second
 * one being made beside it.
 */
export async function signIn(
  sdk: AuthSdk,
  email: string,
  password: string,
  { create = false }: { create?: boolean } = {},
): Promise<Session> {
  const address = email.trim().toLowerCase();
  let uid: string;
  try {
    ({ uid } = await sdk.signIn(address, password));
  } catch (err) {
    if (!isNoSuchUser(err)) throw readable(err);
    // Never made silently. A mistyped email used to create a second account
    // with a different ID — which she would then add to her allowlist, giving
    // a stray account her bookings. She is asked first.
    if (!create) throw new NoAccountError(address);
    try {
      ({ uid } = await sdk.createAccount(address, password));
    } catch (createErr) {
      // Firebase answers a wrong password with the same code as "no account"
      // (so nobody can fish for which emails exist). The create attempt is
      // where a wrong password finally shows itself — and showing her
      // "auth/email-already-in-use" for a typo told her nothing.
      if (codeOf(createErr) === 'auth/email-already-in-use') {
        throw new Error("That password isn't right for this email. Check it and try again.");
      }
      throw readable(createErr);
    }
  }
  const session: Session = { uid, email: address, admitted: false };
  await saveSession(session);
  return session;
}

/** Sign-in failed and there may be no account for this address: ask before making one. */
export class NoAccountError extends Error {
  constructor(readonly email: string) {
    super(`Couldn't sign in as ${email}.`);
    this.name = 'NoAccountError';
  }
}

const codeOf = (err: unknown) => (err as { code?: string })?.code ?? '';

function isNoSuchUser(err: unknown): boolean {
  const code = codeOf(err);
  return code === 'auth/user-not-found' || code === 'auth/invalid-credential';
}

/** Firebase's codes, said as something she can act on. Anything unknown passes through. */
const READABLE: Record<string, string> = {
  'auth/network-request-failed': "Couldn't reach the sign-in service. Check your connection and try again.",
  'auth/too-many-requests': 'Too many tries for now. Wait a few minutes, then try again.',
  'auth/weak-password': 'Choose a password of at least six characters.',
  'auth/invalid-email': "That doesn't look like an email address.",
  'auth/operation-not-allowed': "Email sign-in isn't switched on for this booking service yet.",
};

function readable(err: unknown): unknown {
  const message = READABLE[codeOf(err)];
  return message ? Object.assign(new Error(message), { code: codeOf(err) }) : err;
}

/**
 * Checks whether the allowlist has caught up.
 *
 * A token minted before her uid was allowed in carries no such permission, and
 * claims only change when the token is refreshed — so a refresh comes first,
 * and then the only question worth asking: does Firestore actually let her read
 * something? Anything else is guessing on her behalf.
 */
export async function checkAdmitted(
  sdk: AuthSdk,
  probe: () => Promise<boolean>,
): Promise<boolean> {
  await sdk.refresh();
  // The probe answers yes or no, and THROWS when it cannot tell — offline, or
  // the service down. That is passed on rather than read as "no": telling her
  // she is not on the list when she simply has no signal sends her off to fix
  // something that is not broken. The saved session is left as it was.
  const admitted = await probe();
  const session = await loadSession();
  if (session && session.admitted !== admitted) {
    await saveSession({ ...session, admitted });
  }
  return admitted;
}

export async function signOut(sdk: AuthSdk): Promise<void> {
  await sdk.signOut().catch(() => {});
  await clearSession();
}

/**
 * The line she is shown while waiting to be let in.
 *
 * Her uid is not a secret and not an error — it is the thing she has to copy
 * somewhere. So it is shown plainly, with what to do with it, rather than
 * buried in a failure message.
 */
export function waitingCopy(uid: string): { title: string; body: string; uid: string } {
  return {
    title: 'Nearly there',
    body: 'This device is signed in but not allowed into your database yet. Add this ID to your allowlist, then tap Check again.',
    uid,
  };
}
