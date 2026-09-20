import * as SecureStore from 'expo-secure-store';
import { BookingCredentials } from './bookingLink';

/**
 * The keychain side of the booking link.
 *
 * These never go in the database and never in the iCloud export: the
 * database syncs, and a secret that syncs is a secret in a file. Keeping
 * them here means a lost device is revoked by rotating one key.
 */

const KEY = 'iris.booking.credentials';

// Available once the device has been unlocked after boot — background
// syncs still work, but the keychain item never leaves this device.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function loadCredentials(): Promise<BookingCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
    return raw ? (JSON.parse(raw) as BookingCredentials) : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: BookingCredentials): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds), OPTIONS);
}

/** Unlinks this device. Her bookings stay; only this device's access goes. */
export async function clearCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  } catch {
    // Nothing stored, nothing to remove.
  }
}
