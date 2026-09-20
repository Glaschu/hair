import { generateKeyPair, KeyPairB64 } from './sealedBox';

/**
 * Credentials that connect the app to her booking service.
 *
 * Two secrets live here and they do different jobs: `deviceKey` proves a
 * device is hers when it talks to the service, and `secretKey` is the only
 * thing in the world that can open a sealed booking. Both belong in the
 * keychain, never in the database and never in a sync payload.
 */
export interface BookingCredentials {
  /** Base URL of her service, e.g. https://book.herstudio.co.uk */
  serviceUrl: string;
  /** Bearer token her devices authenticate with. */
  deviceKey: string;
  /** Her salon keypair. The secret half opens bookings. */
  keyPair: KeyPairB64;
}

/** What a pairing QR carries — everything a second device needs, and nothing more. */
export interface PairingPayload {
  v: 1;
  url: string;
  dk: string;   // device key
  pk: string;   // public key
  sk: string;   // secret key
}

/**
 * What the service's own /setup page shows: enough to reach the service,
 * but no salon keys — the first device makes those itself.
 */
export interface SetupPayload {
  v: 1 | 2;
  kind: 'setup';
  url: string;
  dk: string;
  /**
   * Which kind of service this is. Absent on v1 codes, which every deployed
   * setup page still produces — those are self-hosted by definition, since
   * nobody was operating one for her.
   */
  mode?: 'self' | 'hosted';
}

export type ScannedCode =
  /** From the service's /setup page: this device will create the salon keys. */
  | { kind: 'setup'; serviceUrl: string; deviceKey: string; mode: 'self-hosted' | 'hosted' }
  /** From a device already linked: adopt its keys so both can read bookings. */
  | { kind: 'pairing'; credentials: BookingCredentials };

const trimUrl = (url: string) => url.trim().replace(/\/+$/, '');

/** True for an https URL we're willing to send her key to. */
export function isUsableServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(trimUrl(url));
    return parsed.protocol === 'https:' && !!parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Starts a fresh salon: a new keypair, ready to register with the service. */
export function newCredentials(serviceUrl: string, deviceKey: string): BookingCredentials {
  return {
    serviceUrl: trimUrl(serviceUrl),
    deviceKey: deviceKey.trim(),
    keyPair: generateKeyPair(),
  };
}

/**
 * Encodes credentials for the pairing QR shown on a paired device.
 *
 * This is a complete set of keys in a picture: anyone who photographs it
 * can read her bookings. It is only ever shown on demand, on her own
 * screen, and the screen that shows it says so.
 */
export function encodePairing(creds: BookingCredentials): string {
  const payload: PairingPayload = {
    v: 1,
    url: creds.serviceUrl,
    dk: creds.deviceKey,
    pk: creds.keyPair.publicKey,
    sk: creds.keyPair.secretKey,
  };
  return JSON.stringify(payload);
}

/**
 * Reads either QR the app can be shown, so a scan never has to be told
 * which kind it is. Returns null for anything else — a product barcode,
 * someone's Instagram, a URL.
 */
export function decodeScannedCode(scanned: string): ScannedCode | null {
  const pairing = decodePairing(scanned);
  if (pairing) return { kind: 'pairing', credentials: pairing };

  try {
    const raw = JSON.parse(scanned) as Partial<SetupPayload>;
    if (raw?.kind !== 'setup') return null;
    // v1 codes are still being produced by every deployed setup page, and a
    // stylist standing in front of one should not be told her code is invalid
    // because we added a field.
    if (raw.v !== 1 && raw.v !== 2) return null;
    if (typeof raw.url !== 'string' || typeof raw.dk !== 'string' || !raw.dk) return null;
    if (!isUsableServiceUrl(raw.url)) return null;
    return {
      kind: 'setup',
      serviceUrl: trimUrl(raw.url),
      deviceKey: raw.dk,
      mode: raw.mode === 'hosted' ? 'hosted' : 'self-hosted',
    };
  } catch {
    return null;
  }
}

/** Reads a scanned pairing QR. Returns null for anything that isn't one. */
export function decodePairing(scanned: string): BookingCredentials | null {
  try {
    const raw = JSON.parse(scanned) as Partial<PairingPayload>;
    if (raw?.v !== 1) return null;
    const { url, dk, pk, sk } = raw;
    if (typeof url !== 'string' || typeof dk !== 'string') return null;
    if (typeof pk !== 'string' || typeof sk !== 'string') return null;
    if (!isUsableServiceUrl(url) || !dk || !pk || !sk) return null;
    return {
      serviceUrl: trimUrl(url),
      deviceKey: dk,
      keyPair: { publicKey: pk, secretKey: sk },
    };
  } catch {
    return null;
  }
}

/** What to show her about a link so she can tell devices apart — never the keys. */
export function describeService(creds: BookingCredentials): string {
  try {
    return new URL(creds.serviceUrl).hostname;
  } catch {
    return creds.serviceUrl;
  }
}
