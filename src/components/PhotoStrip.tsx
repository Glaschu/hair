import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, Modal, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { ClientPhoto } from '../data/types';
import { getPhotoUri } from '../db/photos';
import { fmt } from '../data/utils';
import { Icons } from './Icons';

interface Props {
  photos: ClientPhoto[];
  /** Tile edge in px. */
  size?: number;
  /** Horizontal scroll strip instead of a wrapping grid. */
  horizontal?: boolean;
  /** Shown when there are no photos (and no add tile). */
  emptyText?: string;
  /** Renders a leading camera tile that calls this. */
  onAdd?: () => void;
}

/**
 * Photo thumbnails with Before/After label chips and a built-in full-screen
 * viewer. Used chair-side, in the visit wrap-up, and on appointment detail.
 */
export function PhotoStrip({ photos, size = 80, horizontal = false, emptyText, onAdd }: Props) {
  const { theme } = useApp();
  const [viewing, setViewing] = useState<ClientPhoto | null>(null);

  const tileStyle = { width: size, height: size, borderRadius: 10, overflow: 'hidden' as const };

  if (photos.length === 0 && !onAdd) {
    return emptyText ? (
      <Text style={{ fontSize: 13, fontStyle: 'italic', color: theme.ink3 }}>{emptyText}</Text>
    ) : null;
  }

  const tiles = (
    <>
      {onAdd && (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add photo"
          style={[tileStyle, styles.addTile, { borderColor: theme.accent + '55', backgroundColor: theme.accent + '0D' }]}
        >
          <Icons.camera size={Math.min(22, size / 3)} color={theme.accent} />
        </Pressable>
      )}
      {photos.map((p) => (
        <Pressable key={p.id} onPress={() => setViewing(p)} style={tileStyle}>
          <Image source={{ uri: getPhotoUri(p.url) }} style={{ flex: 1 }} resizeMode="cover" />
          {p.label ? (
            <View style={styles.labelChip}>
              <Text style={styles.labelChipText}>{p.label.toUpperCase()}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </>
  );

  return (
    <>
      {horizontal ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 10 }}>{tiles}</View>
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{tiles}</View>
      )}

      {viewing && (
        <Modal visible animationType="fade" onRequestClose={() => setViewing(null)}>
          <Pressable style={styles.viewer} onPress={() => setViewing(null)}>
            <Image source={{ uri: getPhotoUri(viewing.url) }} style={styles.viewerImg} resizeMode="contain" />
            <Text style={styles.viewerDate}>
              {fmt.rel(viewing.date)}
              {viewing.label ? ` · ${viewing.label}` : ''}
            </Text>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  addTile: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  labelChip: {
    position: 'absolute', left: 4, bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  labelChipText: { color: '#fff', fontSize: 8, fontWeight: '700', letterSpacing: 0.6 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  viewerImg: { width: '100%', flex: 1, borderRadius: 12 },
  viewerDate: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 12 },
});
