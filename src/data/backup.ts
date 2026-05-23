import { File, Paths } from 'expo-file-system';
import { ExportPayload } from './types';

const BACKUP_FILE = 'iris-autobackup.json';

const backupFile = () => new File(Paths.document, BACKUP_FILE);

/** Writes a silent on-device snapshot. Best-effort — a failure must not disrupt the app. */
export function writeAutoBackup(payload: ExportPayload): void {
  try {
    backupFile().write(JSON.stringify(payload));
  } catch {
    // ignore — the snapshot is insurance, not a critical path
  }
}

/** Reads the last automatic snapshot, or null if there isn't a valid one. */
export function readAutoBackup(): ExportPayload | null {
  try {
    const file = backupFile();
    if (!file.exists) return null;
    const data = JSON.parse(file.textSync());
    if (data?.version !== 1 || !Array.isArray(data.clients)) return null;
    return data as ExportPayload;
  } catch {
    return null;
  }
}
