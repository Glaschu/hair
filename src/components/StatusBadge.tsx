import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { ProductStatus } from '../data/types';

interface Props {
  status: ProductStatus | 'upcoming' | 'completed' | 'cancelled';
  label?: string;
}

export function StatusBadge({ status, label }: Props) {
  const { theme } = useApp();

  const config: Record<string, { bg: string; text: string; defaultLabel: string }> = {
    ok: { bg: theme.sage + '22', text: theme.sage, defaultLabel: 'In Stock' },
    low: { bg: theme.warn + '22', text: theme.warn, defaultLabel: 'Low' },
    out: { bg: theme.danger + '22', text: theme.danger, defaultLabel: 'Out' },
    upcoming: { bg: theme.accent + '22', text: theme.accent, defaultLabel: 'Upcoming' },
    completed: { bg: theme.sage + '22', text: theme.sage, defaultLabel: 'Done' },
    cancelled: { bg: theme.ink3 + '22', text: theme.ink3, defaultLabel: 'Cancelled' },
  };

  const c = config[status] || config.ok;

  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.text }]}>{label || c.defaultLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
