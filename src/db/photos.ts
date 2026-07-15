import { Image } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const photosDir = () => new Directory(Paths.document, 'photos');

// Camera-roll originals are 5–10 MB HEICs; at grid-tile and detail sizes anything
// beyond this edge length is wasted disk, iCloud bandwidth, and decode time.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

async function shrinkToTempJpeg(tempUri: string): Promise<string> {
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) =>
    Image.getSize(tempUri, (w, h) => resolve({ width: w, height: h }), reject)
  );
  const context = ImageManipulator.manipulate(tempUri);
  if (Math.max(width, height) > MAX_DIMENSION) {
    // Cap the longer edge; the other is computed automatically to keep the ratio.
    context.resize(width >= height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return saved.uri;
}

export async function savePhoto(tempUri: string): Promise<string> {
  const dir = photosDir();
  if (!dir.exists) dir.create();

  const filename = `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const dest = new File(dir, filename);

  // Downscale + re-encode (also converts HEIC to JPEG). If anything about the
  // resize fails, fall back to the original file — saving must never fail
  // because of an optimisation.
  let sourceUri = tempUri;
  try {
    sourceUri = await shrinkToTempJpeg(tempUri);
  } catch {
    // keep the original
  }

  const src = new File(sourceUri);
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
