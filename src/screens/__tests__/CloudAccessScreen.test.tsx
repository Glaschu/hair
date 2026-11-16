import React from 'react';
import renderer, { act } from 'react-test-renderer';
import CloudAccessScreen from '../CloudAccessScreen';

/**
 * A smoke test, deliberately shallow.
 *
 * It exists because a typecheck says nothing about whether a screen renders —
 * a missing icon, a bad import or a hook called in the wrong place all compile
 * fine and then throw the moment she opens it. The last few passes verified
 * screens by building and driving a simulator, which is slow for a screen that
 * is only reachable on a deployment nobody has stood up yet.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('../../data/bookingStore', () => ({
  loadCredentials: jest.fn(async () => null),
}));

jest.mock('../../data/auth', () => ({
  loadSession: jest.fn(async () => null),
  stateOf: () => ({ kind: 'signed-out' }),
  waitingCopy: (uid: string) => ({ title: 'Nearly there', body: 'body', uid }),
  signIn: jest.fn(),
  signOut: jest.fn(),
  checkAdmitted: jest.fn(),
}));

// The real one pulls in the Firebase SDK, which has no business loading in a
// unit test — and would not load under jest-expo anyway.
jest.mock('../../data/auth/firebaseSdk', () => ({ firebaseAuthSdk: jest.fn() }));
// The real ones load the Firebase SDK, which is ESM and has no business in a
// render test. What they do is covered in their own tests.
jest.mock('../../data/firestoreDb', () => ({ probeAccess: jest.fn(async () => false) }));
jest.mock('../../data/bookingApi', () => ({
  fetchSalon: jest.fn(), registerSalon: jest.fn(), SalonAlreadySetUpError: class extends Error {},
}));

const theme = {
  bg: '#FAF6F0', bg2: '#F3ECE3', card: '#fff', ink: '#2A201A', ink2: '#6B5B4E',
  ink3: '#A8978A', line: 'rgba(0,0,0,.1)', accent: '#C26E4A', sage: '#6B7B5C',
  heroBg: '#2A201A', danger: '#B84040', warn: '#C07E2A',
};
jest.mock('../../data/AppContext', () => ({ useApp: () => ({ theme }) }));

describe('the database screen', () => {
  it('renders without throwing when there is no Firestore deployment', async () => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => { tree = renderer.create(<CloudAccessScreen />); });

    const text = JSON.stringify(tree!.toJSON());
    // The honest state for a Cloudflare deployment: nothing to sign in to, said
    // plainly rather than shown as a sign-in form that cannot work.
    expect(text).toContain('Nothing to sign in to');
    tree!.unmount();
  });
});
