import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn, useLocalDialog } from '../components';
import { explainAlert } from '../data/moneyAlerts';
import { appointmentIdFor } from '../data/intake';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Money that needs her: disputes, refunds that failed or could not be sent,
 * payments that did not match, payments with no booking.
 *
 * Each says what happened and what to do, because the fix is always somewhere
 * else — her Stripe dashboard, or paying someone back by hand — and she should
 * not have to work out which. Marked as dealt with when she has.
 */
export default function MoneyAlertsScreen() {
  const { theme, moneyAlerts, refreshMoneyAlerts, dismissMoneyAlert, appointments, clients } = useApp();
  const { confirm, alert, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const clientNameFor = (bookingId: string) => {
    const appt = appointments.find((a) => a.id === appointmentIdFor(bookingId));
    return clients.find((c) => c.id === appt?.clientId)?.name ?? null;
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMoneyAlerts();
    } catch {
      await alert({ title: "Couldn't check", message: 'Check your connection and pull down again.' });
    } finally {
      setRefreshing(false);
    }
  };

  const dealtWith = async (id: string) => {
    const ok = await confirm({
      title: 'Mark as dealt with?',
      message: "It won't be shown again. If anything new happens with this payment, it will come back.",
      confirmLabel: 'Dealt with',
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await dismissMoneyAlert(id);
    } catch (e) {
      await alert({
        title: "Couldn't save that",
        message: e instanceof Error ? e.message : 'Check your connection and try again.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.header}>
        <RoundBtn label="Back" onPress={() => nav.goBack()}><Icons.chevronLeft size={20} color={theme.ink} /></RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>Payments</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink3} />}
      >
        {moneyAlerts.length === 0 ? (
          <View style={{ gap: 10, paddingTop: 20 }}>
            <Text style={[styles.title, { color: theme.ink }]}>Nothing needs you</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
              Deposits, refunds and disputes are all in order.
            </Text>
          </View>
        ) : moneyAlerts.map((a) => {
          const { title, body, todo } = explainAlert(a, clientNameFor(a.bookingId));
          const when = a.startsAt
            ? new Date(a.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
            : null;
          return (
            <View key={a.id} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <Text style={[styles.cardTitle, { color: theme.ink }]}>{title}</Text>
              {(a.serviceName || when) && (
                <Text style={{ fontSize: 13, color: theme.ink3 }}>
                  {[a.serviceName, when].filter(Boolean).join(' · ')}
                </Text>
              )}
              {!!body && <Text style={[styles.body, { color: theme.ink2 }]}>{body}</Text>}
              <View style={[styles.todo, { backgroundColor: theme.bg2 }]}>
                <Text style={[styles.label, { color: theme.ink3 }]}>WHAT TO DO</Text>
                <Text style={[styles.body, { color: theme.ink }]}>{todo}</Text>
              </View>
              <Pressable
                onPress={() => dealtWith(a.id)}
                disabled={busyId === a.id}
                style={({ pressed }) => [styles.button, { borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}
              >
                {busyId === a.id
                  ? <ActivityIndicator color={theme.ink2} />
                  : <Text style={{ fontSize: 14, fontWeight: '600', color: theme.ink }}>Mark as dealt with</Text>}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerTitle: { fontSize: 17, fontFamily: SERIF },
  title: { fontSize: 30, fontFamily: SERIF, letterSpacing: -0.4 },
  card: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 14, lineHeight: 20 },
  todo: { borderRadius: 12, padding: 12, gap: 4, marginTop: 4 },
  label: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  button: {
    minHeight: 44, borderRadius: 12, borderWidth: 1, marginTop: 6,
    alignItems: 'center', justifyContent: 'center',
  },
});
