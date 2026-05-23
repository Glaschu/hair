import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { ProductStatus } from '../data/types';

interface Props {
  stock: number;
  reorder: number;
  max?: number;
  status: ProductStatus;
}

export function StockBar({ stock, reorder, max, status }: Props) {
  const { theme } = useApp();
  const ceil = max || Math.max(stock, reorder * 3, 10);
  const fillFlex = Math.round(Math.min(100, (stock / ceil) * 100));
  const emptyFlex = 100 - fillFlex;
  const reorderFlex = Math.round(Math.min(100, (reorder / ceil) * 100));
  const reorderAfterFlex = 100 - reorderFlex;

  const barColor =
    status === 'out' ? theme.danger
    : status === 'low' ? theme.warn
    : theme.sage;

  return (
    <View style={styles.container}>
      {/* Fill bar */}
      <View style={[styles.track, { backgroundColor: theme.bg2 }]}>
        {fillFlex > 0 && <View style={[styles.fill, { flex: fillFlex, backgroundColor: barColor }]} />}
        {emptyFlex > 0 && <View style={{ flex: emptyFlex }} />}
      </View>
      {/* Reorder marker — flex spacer + 2px bar */}
      <View style={styles.markerRow} pointerEvents="none">
        {reorderFlex > 0 && <View style={{ flex: reorderFlex }} />}
        <View style={[styles.marker, { backgroundColor: theme.ink3 }]} />
        {reorderAfterFlex > 0 && <View style={{ flex: reorderAfterFlex }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 6,
    position: 'relative',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 3,
    overflow: 'hidden',
    height: 6,
  },
  fill: {
    height: 6,
  },
  markerRow: {
    position: 'absolute',
    top: -3,
    left: 0,
    right: 0,
    bottom: -3,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  marker: {
    width: 2,
    opacity: 0.4,
    borderRadius: 1,
  },
});
