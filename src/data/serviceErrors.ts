/**
 * Why her booking service could not be reached, in words she can act on.
 *
 * "Check your connection" is only the right advice when it IS the connection.
 * Signed out, no longer linked, not yet let in, or the service itself in
 * trouble each need something else from her, and sending her to her Wi-Fi
 * instead wastes her morning while nothing gets through.
 */

/** A refusal or failure the service answered with — already worded for her. */
export class ServiceError extends Error {
  constructor(message: string, readonly kind: 'refused' | 'trouble') {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface Failure {
  /** True when the likeliest cause is no signal, so waiting will fix it. */
  offline: boolean;
  message: string;
}

const NOT_LET_IN =
  "This device isn't allowed into your booking service yet. Settings → Online booking → Your database.";
const SIGN_IN_AGAIN =
  'Sign in to your booking service again — Settings → Online booking → Your database.';

/**
 * Sorts an error into "no signal" or "something she has to do".
 *
 * Anything unrecognised counts as no signal: a failed fetch carries no more
 * than "Network request failed", and that is by far the commonest case.
 */
export function describeFailure(e: unknown, offlineMessage: string): Failure {
  const err = e as { name?: string; code?: string; message?: string } | null | undefined;
  switch (err?.name) {
    case 'ServiceError':
    case 'NotSignedInError':
    case 'ServiceVersionError':
      return { offline: false, message: String(err.message) };
  }
  // Firestore's own codes, on the Firebase deployment.
  if (err?.code === 'permission-denied') return { offline: false, message: NOT_LET_IN };
  if (err?.code === 'unauthenticated') return { offline: false, message: SIGN_IN_AGAIN };
  return { offline: true, message: offlineMessage };
}
