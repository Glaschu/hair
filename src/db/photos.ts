import { File, Directory, Paths } from 'expo-file-system';

const photosDir = () => new Directory(Paths.document, 'photos');

export async function savePhoto(tempUri: string): Promise<string> {
  const dir = photosDir();
  if (!dir.exists) dir.create();

  const filename = `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const dest = new File(dir, filename);

  const src = new File(tempUri);
  src.copy(dest);

  return filename;
}

export function getPhotoUri(urlOrFilename: string): string {
  if (!urlOrFilename) return '';
  const filename = urlOrFilename.split('/').pop();
  if (!filename) return '';
  const dir = photosDir();
  return new File(dir, filename).uri;
}

export async function deletePhoto(uri: string): Promise<void> {
  try {
    const file = new File(getPhotoUri(uri));
    if (file.exists) file.delete();
  } catch {
    // best-effort cleanup — a leftover file is harmless
  }
}
