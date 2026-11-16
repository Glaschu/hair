import { seal, unseal } from './sealedBox';

/**
 * Which client a booking link was sent to — readable by her devices and no one
 * else.
 *
 * A link carries a `clientRef`, and every booking made through the link carries
 * it back. It used to be a random string, with the client it stood for kept in
 * a table on the ONE device that sent the link. Send from the iPad, pull
 * bookings on the phone, and the phone had no idea who the booking was for —
 * so it fell back to guessing from a phone number, or made a new client card.
 *
 * Now the client's id is sealed to her own salon key, which every device she
 * has paired holds. Any of them can open it, nothing has to be synced for that
 * to work, and it survives a reinstall restored from backup.
 *
 * The service still learns nothing: it cannot open the seal, and a fresh seal
 * is made for every link — new ephemeral key, new nonce — so it cannot even
 * tell that two links went to the same person.
 */

/** Marks a sealed reference, so the random ones on links already out there still resolve. */
const PREFIX = 'c1.';

export function sealClientRef(clientId: string, salonPublicKey: string): string {
  return PREFIX + seal(JSON.stringify({ c: clientId }), salonPublicKey);
}

/** The client id inside a sealed reference, or null if it isn't one of ours. */
export function openClientRef(ref: string, salonSecretKey: string): string | null {
  if (!ref?.startsWith(PREFIX)) return null;
  const json = unseal(ref.slice(PREFIX.length), salonSecretKey);
  if (!json) return null;
  try {
    const value = JSON.parse(json);
    return typeof value?.c === 'string' && value.c ? value.c : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a reference from either generation of link.
 *
 * @param legacy  the sending device's table, for links minted before references
 *                were sealed — still out there for up to three weeks.
 */
export function clientIdForRef(
  ref: string,
  salonSecretKey: string,
  legacy: (ref: string) => string | null,
): string | null {
  return openClientRef(ref, salonSecretKey) ?? (ref ? legacy(ref) : null);
}
