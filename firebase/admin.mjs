import { createRequire } from 'node:module';

/**
 * Admin access to her Firestore using the Firebase CLI's own sign-in.
 *
 * The CLI has no command that writes a document, and gcloud is often not
 * installed — so the allowlist (who may read her bookings) could only be
 * edited in the console. This borrows the session `firebase login` already
 * holds: the same access `firebase deploy` uses, on her own project, and the
 * token never leaves this process.
 */
const require = createRequire(import.meta.url);

export async function cliAccessToken() {
  const auth = require('firebase-tools/lib/auth');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const apiv2 = require('firebase-tools/lib/apiv2');
  const account = auth.getGlobalDefaultAccount?.();
  if (!account) throw new Error('Not signed in to the Firebase CLI — run `npx firebase login`.');
  await requireAuth({ user: account.user, tokens: account.tokens });
  return apiv2.getAccessToken();
}

/** A Firestore REST call on the project, as the signed-in CLI user. */
export async function firestore(project, method, path, body) {
  const token = await cliAccessToken();
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
