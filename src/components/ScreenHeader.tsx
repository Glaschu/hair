import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { SERIF } from '../theme';

interface Props {
  eyebrow?: string;
  title: string;
  right?: React.ReactNode;
  left?: React.ReactNode;
}

export function ScreenHeader({ eyebrow, title, right, left }: Props) {
  const { theme } = useApp();

  return (
    <View style={styles.container}>
      {left && <View style={styles.left}>{left}</View>}
      <View style={styles.titleArea}>
        {eyebrow && (
          <Text style={[styles.eyebrow, { color: theme.ink3 }]}>{eyebrow.toUpperCase()}</Text>
        )}
        <Text style={[styles.title, { color: theme.ink }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  left: {
    marginRight: 12,
    marginBottom: 4,
  },
  titleArea: {
    flex: 1,
  },
  right: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 6,
    fontWeight: '400',
  },
  title: {
    fontFamily: SERIF,
    fontSize: 34,
    letterSpacing: -0.4,
    lineHeight: 38,
  },
});
