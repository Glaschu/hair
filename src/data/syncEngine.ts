import { CloudStorage } from 'react-native-cloud-storage';
import { File, Paths, Directory } from 'expo-file-system';
import { ExportPayload, ClientPhoto } from './types';

const SYNC_FILE = '/iris-sync.json';

/**
 * Pushes the current local database state to iCloud.
 */
export async function pushSync(payload: ExportPayload): Promise<void> {
  const available = await CloudStorage.isCloudAvailable();
  if (!available) throw new Error('iCloud is not available on this device');

  let finalPayload = payload;
  const exists = await CloudStorage.exists(SYNC_FILE);
  if (exists) {
    try {
      const raw = await CloudStorage.readFile(SYNC_FILE);
      const remote = JSON.parse(raw) as ExportPayload;
      if (remote.version === 1) {
        finalPayload = {
          version: 1,
          exported: new Date().toISOString(),
          clients: mergeArrays(payload.clients, remote.clients),
          products: mergeArrays(payload.products, remote.products),
          appointments: mergeArrays(payload.appointments, remote.appointments),
          services: mergeArrays(payload.services, remote.services),
          schedule: { ...remote.schedule, ...payload.schedule },
        };
      }
    } catch (e) {
      console.warn('Failed to parse remote file before push', e);
    }
  }

  const json = JSON.stringify(finalPayload);
  await CloudStorage.writeFile(SYNC_FILE, json);
  
  // Explicitly tell the OS iCloud daemon to push this file to the cloud immediately
  try {
    await CloudStorage.triggerSync(SYNC_FILE);
  } catch {}
}

/**
 * Pulls the remote state from iCloud and merges it with the local state based on updatedAt.
 * Returns the merged payload, or null if there is no remote data.
 */
export async function pullSync(localPayload: ExportPayload): Promise<ExportPayload | null> {
  const available = await CloudStorage.isCloudAvailable();
  if (!available) throw new Error('iCloud is not available on this device');

  try {
    await CloudStorage.triggerSync(SYNC_FILE);
  } catch {
    // Ignore if unsupported or offline
  }

  const exists = await CloudStorage.exists(SYNC_FILE);
  if (!exists) return null; // Nothing to pull

  const raw = await CloudStorage.readFile(SYNC_FILE);
  const remote = JSON.parse(raw) as ExportPayload;

  if (remote.version !== 1) throw new Error('Unsupported sync version');

  const merged: ExportPayload = {
    version: 1,
    exported: new Date().toISOString(),
    clients: mergeArrays(localPayload.clients, remote.clients),
    products: mergeArrays(localPayload.products, remote.products),
    appointments: mergeArrays(localPayload.appointments, remote.appointments),
    services: mergeArrays(localPayload.services, remote.services),
    schedule: { ...localPayload.schedule, ...remote.schedule },
  };

  return merged;
}

/**
 * Merges two arrays of objects based on their `id` and `updatedAt` properties.
 * If an item exists in both, the one with the higher `updatedAt` is kept.
 */
function mergeArrays<T extends { id: string; updatedAt?: number }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();

  // Add local items
  for (const item of local) {
    map.set(item.id, item);
  }

  // Merge remote items
  for (const item of remote) {
    const existing = map.get(item.id);
    if (existing) {
      const localTime = existing.updatedAt ?? 0;
      const remoteTime = item.updatedAt ?? 0;
      if (remoteTime > localTime) {
        map.set(item.id, item);
      }
    } else {
      map.set(item.id, item);
    }
  }


  return Array.from(map.values());
}

/**
 * Syncs photos bidirectionally between local device and iCloud.
 */
export async function syncPhotos(photos: ClientPhoto[]): Promise<void> {
  try {
    const available = await CloudStorage.isCloudAvailable();
    if (!available) return;
  } catch {
    return;
  }

  const localDir = new Directory(Paths.document, 'photos');
  if (!localDir.exists) localDir.create();

  // Create remote dir if not exists
  try {
    const remoteExists = await CloudStorage.exists('/photos');
    if (!remoteExists) {
      await CloudStorage.mkdir('/photos');
    }
  } catch {
    // might fail if exists or no permission, ignore
  }

  const remoteFiles = await CloudStorage.readdir('/photos').catch(() => [] as string[]);

  for (const photo of photos) {
    if (!photo.url) continue;
    const filename = photo.url.split('/').pop();
    if (!filename) continue;

    const localFile = new File(localDir, filename);
    const remotePath = `/photos/${filename}`;
    
    try {
      await CloudStorage.triggerSync(remotePath);
    } catch {}

    const existsRemote = remoteFiles.includes(filename);

    if (localFile.exists && !existsRemote) {
      // Upload local to remote
      try {
        await CloudStorage.uploadFile(remotePath, localFile.uri.replace(/^file:\/\//, ''), { mimeType: 'image/jpeg' });
      } catch (e) {
        console.warn('Failed to upload photo', e);
      }
    } else if (!localFile.exists && existsRemote) {
      // Download remote to local
      try {
        await CloudStorage.downloadFile(remotePath, localFile.uri.replace(/^file:\/\//, ''));
      } catch (e) {
        console.warn('Failed to download photo', e);
      }
    }
  }
}

