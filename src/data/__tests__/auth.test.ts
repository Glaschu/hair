import * as SecureStore from 'expo-secure-store';
import {
  signIn, signOut, NoAccountError, checkAdmitted, stateOf, waitingCopy,
  loadSession, saveSession, clearSession,
  type AuthSdk, type Session,
} from '../auth';

/**
 * Signing in exists for one reason: Firestore will not talk to her otherwise.
 * So these tests are about the awkward middle — signed in, but not yet allowed
 * in — because that is the state every self-hosted first run lands in, and the
 * one that reads as "broken" if the app says nothing useful.
 */

// The keychain, faked, so a test run never touches the real one.
// Jest hoists the mock factory above this, so the name must start with `mock`.
const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afu',
  getItemAsync: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockKeychain.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockKeychain.delete(k); }),
}));

const fakeSdk = (over: Partial<AuthSdk> = {}): AuthSdk => ({
  signIn: jest.fn(async () => ({ uid: 'uid-existing' })),
  createAccount: jest.fn(async () => ({ uid: 'uid-new' })),
  signOut: jest.fn(async () => {}),
  refresh: jest.fn(async () => {}),
  currentUid: jest.fn(() => 'uid-existing'),
  ...over,
});

const rejects = (code: string) => jest.fn(async () => {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  throw e;
});

beforeEach(() => { mockKeychain.clear(); jest.clearAllMocks(); });

describe('signing in on a fresh self-hosted project', () => {
  it('never creates an account without being asked — a typo must not make a stray one', async () => {
    // A mistyped email used to silently create a second account with a new ID,
    // which she would then add to her allowlist.
    const sdk = fakeSdk({ signIn: rejects('auth/invalid-credential') });
    await expect(signIn(sdk, 'her@salom.test', 'a-password')).rejects.toThrow(NoAccountError);
    expect(sdk.createAccount).not.toHaveBeenCalled();
  });

  it('creates the account when there is not one yet, once she confirms', async () => {
    // Nobody has made her an account — self-hosting means she is the first and
    // only user of her own project.
    const sdk = fakeSdk({ signIn: rejects('auth/user-not-found') });
    const session = await signIn(sdk, 'her@salon.test', 'a-password', { create: true });

    expect(sdk.createAccount).toHaveBeenCalledWith('her@salon.test', 'a-password');
    expect(session.uid).toBe('uid-new');
  });

  it('signs in to the existing account rather than making a second one', async () => {
    const sdk = fakeSdk();
    const session = await signIn(sdk, 'her@salon.test', 'a-password');

    expect(sdk.createAccount).not.toHaveBeenCalled();
    expect(session.uid).toBe('uid-existing');
  });

  it('tries to sign in first, so a wrong password can never create a duplicate', async () => {
    // Order matters. Creating first and falling back would quietly stand up a
    // second account beside the real one, with a different uid — which is not
    // on the allowlist, so the app would look broken for no visible reason.
    const sdk = fakeSdk();
    await signIn(sdk, 'her@salon.test', 'pw');
    expect(sdk.signIn).toHaveBeenCalled();
  });

  it('passes a real failure through rather than making an account over it', async () => {
    const sdk = fakeSdk({ signIn: rejects('auth/wrong-password') });
    await expect(signIn(sdk, 'her@salon.test', 'pw')).rejects.toThrow();
    expect(sdk.createAccount).not.toHaveBeenCalled();
  });

  it('tidies the address, because she will type it differently next time', async () => {
    const sdk = fakeSdk();
    const session = await signIn(sdk, '  Her@Salon.TEST  ', 'pw');
    expect(session.email).toBe('her@salon.test');
  });

  it('starts out not yet admitted, which is the truth', async () => {
    const sdk = fakeSdk();
    const session = await signIn(sdk, 'her@salon.test', 'pw');
    expect(session.admitted).toBe(false);
  });

  it('a mistyped password says so, rather than "auth/email-already-in-use"', async () => {
    // Firebase answers a wrong password exactly as it answers "no account", so
    // the create attempt is where it surfaces — as a code she cannot read.
    const sdk = fakeSdk({
      signIn: rejects('auth/invalid-credential'),
      createAccount: rejects('auth/email-already-in-use'),
    });
    await expect(signIn(sdk, 'her@salon.test', 'typo', { create: true })).rejects.toThrow("That password isn't right for this email");
  });

  it('no signal reads as no signal', async () => {
    const sdk = fakeSdk({ signIn: rejects('auth/network-request-failed') });
    await expect(signIn(sdk, 'her@salon.test', 'pw')).rejects.toThrow(/Check your connection/);
  });
});

describe('the session survives the app closing', () => {
  it('is kept in the keychain, not in memory', async () => {
    await signIn(fakeSdk(), 'her@salon.test', 'pw');
    expect(await loadSession()).toMatchObject({ uid: 'uid-existing', email: 'her@salon.test' });
  });

  it('is written with a keychain class that does not sync off the device', async () => {
    await signIn(fakeSdk(), 'her@salon.test', 'pw');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ keychainAccessible: 'afu' }),
    );
  });

  it('survives a keychain that refuses to answer', async () => {
    // A read that throws must read as signed-out, not crash the app on launch.
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    expect(await loadSession()).toBeNull();
  });

  it('is gone after signing out', async () => {
    const sdk = fakeSdk();
    await signIn(sdk, 'her@salon.test', 'pw');
    await signOut(sdk);
    expect(await loadSession()).toBeNull();
  });

  it('signs out locally even when the SDK call fails', async () => {
    // Offline sign-out must still work. Leaving a session behind would show her
    // a signed-in app that cannot read anything.
    const sdk = fakeSdk({ signOut: jest.fn(async () => { throw new Error('offline'); }) });
    await saveSession({ uid: 'u', email: 'e', admitted: true });
    await signOut(sdk);
    expect(await loadSession()).toBeNull();
  });
});

describe('the awkward middle: signed in, not yet allowed in', () => {
  it('refreshes the token before asking, because that is where permission lives', async () => {
    // A token minted before her uid was allowed in carries no such permission,
    // and claims only change when the token is refreshed.
    const sdk = fakeSdk();
    const order: string[] = [];
    (sdk.refresh as jest.Mock).mockImplementation(async () => { order.push('refresh'); });
    await checkAdmitted(sdk, async () => { order.push('probe'); return true; });
    expect(order).toEqual(['refresh', 'probe']);
  });

  it('decides by actually reading something, not by guessing', async () => {
    await saveSession({ uid: 'u', email: 'e', admitted: false });
    expect(await checkAdmitted(fakeSdk(), async () => true)).toBe(true);
    expect(await loadSession()).toMatchObject({ admitted: true });
  });

  it('a probe that cannot tell says so, and leaves the session as it was', async () => {
    // Offline is not "you're not on the list". Reading it that way sent her off
    // to fix an allowlist that was fine. The probe itself turns a genuine
    // denial into `false`; anything it throws is "couldn't tell".
    await saveSession({ uid: 'u', email: 'e', admitted: true });
    await expect(checkAdmitted(fakeSdk(), async () => { throw new Error('unavailable'); }))
      .rejects.toThrow('unavailable');
    expect(await loadSession()).toMatchObject({ admitted: true });
  });

  it('notices access being taken away again', async () => {
    // Removed from the allowlist. The app must stop claiming to be ready.
    await saveSession({ uid: 'u', email: 'e', admitted: true });
    expect(await checkAdmitted(fakeSdk(), async () => false)).toBe(false);
    expect(await loadSession()).toMatchObject({ admitted: false });
  });

  it('does not rewrite the session when nothing changed', async () => {
    await saveSession({ uid: 'u', email: 'e', admitted: true });
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    await checkAdmitted(fakeSdk(), async () => true);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('what the app shows', () => {
  const session = (over: Partial<Session> = {}): Session =>
    ({ uid: 'uid-1', email: 'her@salon.test', admitted: false, ...over });

  it('distinguishes signed-out from waiting from ready', () => {
    expect(stateOf(null).kind).toBe('signed-out');
    expect(stateOf(session()).kind).toBe('waiting-for-access');
    expect(stateOf(session({ admitted: true })).kind).toBe('ready');
  });

  it('shows the uid plainly, because it is a thing to copy and not an error', () => {
    const copy = waitingCopy('uid-1');
    expect(copy.uid).toBe('uid-1');
    expect(copy.body).toMatch(/allowlist/i);
    expect(copy.body).toMatch(/check again/i);
  });

  it('never calls the waiting state a failure', () => {
    // It is the normal first run on a self-hosted project. Wording it as an
    // error would send her looking for a fault that is not there.
    const copy = waitingCopy('uid-1');
    expect(`${copy.title} ${copy.body}`).not.toMatch(/error|failed|denied|problem/i);
  });
});
