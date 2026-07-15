import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { SERIF } from '../theme';

interface Props {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: Props) {
  const { theme } = useApp();

  return (
    <View style={styles.container}>
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text style={[styles.title, { color: theme.ink2 }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: theme.ink3 }]}>{subtitle}</Text>}
      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  icon: {
    marginBottom: 16,
    opacity: 0.4,
  },
  title: {
    fontFamily: SERIF,
    fontSize: 19,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  action: {
    marginTop: 20,
  },
});
