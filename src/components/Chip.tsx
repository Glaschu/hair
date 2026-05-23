import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';

interface Props {
  children: React.ReactNode;
  active?: boolean;
  onPress?: () => void;
}

export function Chip({ children, active, onPress }: Props) {
  const { theme } = useApp();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.ink : theme.bg2,
        },
      ]}
    >
      <Text style={[styles.label, { color: active ? theme.bg : theme.ink2 }]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
    includeFontPadding: false,
  },
});
