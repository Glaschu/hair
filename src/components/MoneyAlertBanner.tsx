import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { Icons } from './Icons';
import { alertHeadline } from '../data/moneyAlerts';

/**
 * Money that needs her, at the top of the day — only when there is some.
 *
 * Disputes and failed refunds used to be recorded and shown to no one. A
 * dispute has a deadline; a refund that silently failed is a client who
 * believes they were paid back. So it sits above everything else on Today
 * until she has dealt with it.
 */
export function MoneyAlertBanner({ style }: { style?: object }) {
  const { theme, moneyAlerts } = useApp();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!moneyAlerts.length) return null;

  const n = moneyAlerts.length;
  return (
    <Pressable
      onPress={() => nav.navigate('MoneyAlerts')}
      accessibilityRole="button"
      accessibilityLabel={`${n} payment${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} your attention`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.danger + '12', borderColor: theme.danger + '40', opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: theme.danger + '20' }]}>
        <Icons.alert size={16} color={theme.danger} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: theme.ink }]}>
          {n === 1 ? 'A payment needs you' : `${n} payments need you`}
        </Text>
        <Text style={[styles.sub, { color: theme.ink2 }]} numberOfLines={2}>
          {alertHeadline(moneyAlerts[0].kind)}{n > 1 ? `, and ${n - 1} more` : ''}
        </Text>
      </View>
      <Icons.chevronRight size={16} color={theme.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 16, padding: 14,
  },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 13, marginTop: 2, lineHeight: 18 },
});
