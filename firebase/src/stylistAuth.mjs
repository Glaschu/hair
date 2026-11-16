/**
 * Who is calling the stylist routes on the Firebase deployment.
 *
 * The Cloudflare version authenticates her devices with a bearer device key.
 * Here she already signs in with Firebase Auth, so the bearer is her ID token,
 * checked the same way the security rules check it: a `stylist` claim, or a
 * uid on the allowlist. One rule for both doors, so the API can never let in
 * someone the database would turn away.
 *
 * @param verify  (idToken) => decoded claims — the Admin SDK's verifyIdToken in
 *                production; injected so tests need no Auth emulator.
 */
export async function stylistFrom(req, db, verify) {
  const header = req.get?.('authorization') ?? req.headers?.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { status: 401 };

  let claims;
  try {
    claims = await verify(match[1]);
  } catch {
    return { status: 401 };
  }

  // Anonymous sign-in would make "signed in" mean "anyone". The rules refuse
  // it; so does this.
  if (claims?.firebase?.sign_in_provider === 'anonymous') return { status: 403 };
  if (claims?.stylist === true) return { status: 200, claims };

  const access = await db.doc('config/access').get();
  const uids = access.exists ? access.data().uids ?? [] : [];
  return uids.includes(claims?.uid) ? { status: 200, claims } : { status: 403 };
}
