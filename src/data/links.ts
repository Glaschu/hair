import { Linking } from 'react-native';

/**
 * Normalises whatever got typed into the Instagram field down to a bare
 * handle: "@margot.hair", "margot.hair", or a pasted profile URL all give
 * "margot.hair". Returns '' when there's nothing usable.
 */
export function instagramHandle(raw: string | undefined): string {
  if (!raw) return '';
  let h = raw.trim();
  h = h.replace(/^https?:\/\//i, '').replace(/^(www\.|m\.)/i, '');
  h = h.replace(/^instagram\.com\//i, '');
  h = h.split(/[/?#]/)[0];
  h = h.replace(/^@+/, '').trim();
  // Instagram handles are letters, numbers, dots and underscores.
  return /^[A-Za-z0-9._]+$/.test(h) ? h : '';
}

/** Opens a URL, reporting whether it actually went anywhere. */
async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a DM thread with a client on Instagram — the thing a stylist
 * actually wants, since clients send inspo pictures by DM.
 *
 * Three attempts, because no single URL covers every case:
 *
 * 1. `ig.me/m/<handle>` is Meta's own DM deeplink. It only gets tried when
 *    we know Instagram is installed: with no app to catch it, the same URL
 *    quietly opens Safari and `openURL` reports success either way, so we
 *    would never find out it had missed.
 * 2. `instagram://user?username=` lands on their profile. `openURL` rejects
 *    a scheme nothing handles, so this both probes and opens — which is why
 *    it runs even when step 1 was skipped. `canOpenURL` answers false for
 *    any scheme missing from LSApplicationQueriesSchemes, and a build whose
 *    Info.plist has drifted from app.json is exactly the case where the app
 *    is installed and we were told otherwise.
 * 3. The web profile, for a device with no Instagram at all (an iPad,
 *    usually).
 */
export async function openInstagram(raw: string | undefined): Promise<void> {
  const handle = instagramHandle(raw);
  if (!handle) return;

  let hasApp = false;
  try {
    hasApp = await Linking.canOpenURL('instagram://app');
  } catch {
    hasApp = false;
  }

  if (hasApp && await tryOpen(`https://ig.me/m/${handle}`)) return;
  if (await tryOpen(`instagram://user?username=${handle}`)) return;
  await tryOpen(`https://www.instagram.com/${handle}`);
}
