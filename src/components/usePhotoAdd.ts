import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../data/AppContext';
import { ClientPhoto } from '../data/types';
import { savePhoto } from '../db/photos';
import type { DialogApi } from './Dialog';

export interface AddPhotoOptions {
  clientId: string;
  /** Ties the photos to a visit — they show on that appointment and in the client gallery. */
  appointmentId?: string;
  /** e.g. 'Before' / 'After' — shown as a chip on thumbnails. */
  label?: string;
}

/**
 * Camera-or-library photo capture that saves into the client's gallery.
 * Pass the dialog API in scope (useLocalDialog on modal screens so sheets
 * stack above them, the app-wide useDialog elsewhere).
 */
export function usePhotoAdd(dialog: Pick<DialogApi, 'actionSheet' | 'alert'>) {
  const { setClients } = useApp();

  return async function addPhotos({ clientId, appointmentId, label }: AddPhotoOptions): Promise<boolean> {
    const action = await dialog.actionSheet({
      title: 'Add Photo',
      actions: [{ label: 'Take Photo' }, { label: 'Choose from Library' }],
    });
    if (action === null) return false;

    let result: ImagePicker.ImagePickerResult;
    try {
      if (action === 0) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          await dialog.alert({ title: 'Permission Denied', message: 'Camera access is required to take photos.' });
          return false;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          await dialog.alert({ title: 'Permission Denied', message: 'Photo library access is required to choose photos.' });
          return false;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          allowsMultipleSelection: true, quality: 0.8,
          mediaTypes: ['images'],
        });
      }
    } catch (e) {
      console.log('ImagePicker Error:', e);
      await dialog.alert({ title: 'Error', message: 'Could not open the camera or library on this device.' });
      return false;
    }

    if (result.canceled) return false;
    try {
      const saved = await Promise.all(result.assets.map((a) => savePhoto(a.uri)));
      const newPhotos: ClientPhoto[] = saved.map((url) => ({
        id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: new Date().toISOString(),
        url,
        label: label ?? '',
        appointmentId,
      }));
      setClients((cs) => cs.map((c) => c.id === clientId
        ? { ...c, photos: [...newPhotos, ...(c.photos || [])] }
        : c));
      return true;
    } catch {
      return false;
    }
  };
}
