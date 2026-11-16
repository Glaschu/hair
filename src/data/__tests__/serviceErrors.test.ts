import { describeFailure, ServiceError } from '../serviceErrors';

/**
 * "Check your connection" sends her to her Wi-Fi. That is only right when it
 * is the Wi-Fi — anything she has to do herself must be said as itself.
 */

const OFFLINE = 'Check your connection.';

it('a failed fetch is the connection', () => {
  expect(describeFailure(new TypeError('Network request failed'), OFFLINE)).toEqual({ offline: true, message: OFFLINE });
});

it('a device that is no longer linked is told so, not sent to its Wi-Fi', () => {
  const e = new ServiceError('This device is no longer linked. Set it up again.', 'refused');
  expect(describeFailure(e, OFFLINE)).toEqual({ offline: false, message: e.message });
});

it('the service in trouble is not her connection either', () => {
  const e = new ServiceError('The booking service is having trouble. Try again shortly.', 'trouble');
  expect(describeFailure(e, OFFLINE).offline).toBe(false);
});

it('a lapsed sign-in says sign in', () => {
  const e = Object.assign(new Error('Sign in again.'), { name: 'NotSignedInError' });
  expect(describeFailure(e, OFFLINE)).toEqual({ offline: false, message: 'Sign in again.' });
});

it("Firestore's refusals are worded for her", () => {
  expect(describeFailure({ code: 'permission-denied' }, OFFLINE).message).toMatch(/isn't allowed/);
  expect(describeFailure({ code: 'unauthenticated' }, OFFLINE).message).toMatch(/Sign in/);
});
