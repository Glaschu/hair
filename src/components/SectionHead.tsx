import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { SERIF } from '../theme';

interface Props {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}

export function SectionHead({ eyebrow, title, action }: Props) {
  const { theme } = useApp();

  return (
    <View style={styles.row}>
      <View>
        {eyebrow && (
          <Text style={[styles.eyebrow, { color: theme.ink3 }]}>{eyebrow.toUpperCase()}</Text>
        )}
        <Text style={[styles.title, { color: theme.ink }]}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '400',
    marginBottom: 4,
  },
  title: {
    fontFamily: SERIF,
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
});
