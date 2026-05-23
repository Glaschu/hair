import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { initials } from '../data/utils';
import { useApp } from '../data/AppContext';

interface Props {
  name: string;
  tone?: string;
  size?: number;
  photo?: string;
}

export function Avatar({ name, tone, size = 44, photo }: Props) {
  const { theme } = useApp();
  const bg = tone || theme.accent;
  const fontSize = size * 0.38;

  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.text, { fontSize, color: '#fff' }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    fontStyle: 'italic',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
});
