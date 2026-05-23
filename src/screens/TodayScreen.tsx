import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useApp } from '../data/AppContext';
import { useDialog } from '../data/DialogContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Icons, RoundBtn } from '../components';
import { fmt, addDays, isSameDay } from '../data/utils';
import { deductStock, restoreStock } from '../data/stock';
import { notifyLowStock } from '../data/notifications';
import { Appointment } from '../data/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function greetingFor(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function timeHour(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  return String(h);
}

function timeAmPm(iso: string): string {
  return new Date(iso).getHours() >= 12 ? 'PM' : 'AM';
}

export default function TodayScreen() {
  const { theme, appointments, clients, products, studioName } = useApp();
  const nav = useNavigation<Nav>();

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const tomorrow = useMemo(() => addDays(today, 1), [today]);

  const todayAppts = useMemo(() =>
    appointments
      .filter((a) => {
        const d = new Date(a.start);
        return d >= today && d < tomorrow;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, today, tomorrow]
  );

  const lowStock = products.filter((p) => p.status === 'low' || p.status === 'out');

  const now = new Date();
  const nextApptId = todayAppts.find((a) => new Date(a.start) > now)?.id;

  const totalRevenue = todayAppts.reduce((s, a) => s + a.price, 0);
  const totalHours = todayAppts.reduce((s, a) => {
    return s + (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000;
  }, 0);

  // Week peek: upcoming appointments in the next 7 days (excluding today)
  const weekPeek = useMemo(() =>
    appointments
      .filter((a) => {
        const d = new Date(a.start);
        const weekEnd = addDays(today, 7);
        return d > tomorrow && d <= weekEnd && a.status === 'upcoming';
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 3),
    [appointments, today, tomorrow]
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: theme.ink3 }]}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
            </Text>
            <Text style={[styles.greeting, { color: theme.ink }]}>
              {greetingFor()},{'\n'}<Text style={{ fontStyle: 'italic', fontWeight: '400' }}>{studioName}</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <RoundBtn onPress={() => nav.navigate('Settings')} size={40}>
              <Icons.settings size={18} color={theme.ink2} />
            </RoundBtn>
          </View>
        </View>

        {/* Day at a glance — dark hero card */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <Pressable
            onPress={() => nav.navigate('Reports')}
            style={({ pressed }) => [styles.heroCard, { backgroundColor: theme.heroBg, opacity: pressed ? 0.9 : 1 }]}
          >
            <View style={styles.heroTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroEyebrow}>DAY AT A GLANCE</Text>
                <Text style={styles.heroAppts}>
                  {todayAppts.length}{' '}
                  <Text style={{ fontStyle: 'italic', opacity: 0.7 }}>appointments</Text>
                </Text>
              </View>
              <View style={[styles.heroIcon, { backgroundColor: theme.accent }]}>
                <Icons.scissors size={20} color="#fff" />
              </View>
            </View>
            <View style={styles.heroStats}>
              {[
                { l: 'Revenue', v: fmt.currency(totalRevenue) },
                { l: 'Hours', v: `${totalHours.toFixed(1)}h` },
                { l: 'Reports', v: '→' },
              ].map((s) => (
                <View key={s.l} style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>{s.l}</Text>
                  <Text style={styles.heroStatVal}>{s.v}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        </View>

        {/* Low stock alert */}
        {lowStock.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <Pressable
              onPress={() => nav.navigate('MainTabs', { screen: 'Inventory' } as any)}
              style={({ pressed }) => [
                styles.alertCard,
                { backgroundColor: 'rgba(192,126,42,0.10)', borderColor: theme.warn, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={[styles.alertIcon, { backgroundColor: theme.warn }]}>
                <Icons.alert size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: theme.ink }]}>
                  {lowStock.length} product{lowStock.length > 1 ? 's' : ''} need restocking
                </Text>
                <Text style={[styles.alertSub, { color: theme.ink2 }]} numberOfLines={1}>
                  {lowStock.slice(0, 2).map((p) => p.name).join(', ')}
                  {lowStock.length > 2 ? ` + ${lowStock.length - 2} more` : ''}
                </Text>
              </View>
              <Icons.chevronRight size={16} color={theme.ink3} />
            </Pressable>
          </View>
        )}

        {/* Schedule */}
        <View style={styles.sectionHead}>
          <View>
            <Text style={[styles.sectionEye, { color: theme.ink3 }]}>THE DAY</Text>
            <Text style={[styles.sectionTitle, { color: theme.ink }]}>Schedule</Text>
          </View>
          <Pressable
            onPress={() => nav.navigate('NewAppointment', {})}
            style={styles.newBtn}
          >
            <Icons.plus size={14} color={theme.accent} strokeWidth={2} />
            <Text style={[styles.newBtnText, { color: theme.accent }]}>New</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {todayAppts.length === 0 ? (
            <View style={[styles.emptyDay, { backgroundColor: theme.bg2 }]}>
              <Text style={[styles.emptyText, { color: theme.ink3 }]}>No appointments today</Text>
            </View>
          ) : (
            todayAppts.map((appt) => (
              <ApptCard key={appt.id} appt={appt} isNext={appt.id === nextApptId} />
            ))
          )}
        </View>

        {/* This week peek */}
        {weekPeek.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={styles.sectionHead}>
              <View>
                <Text style={[styles.sectionEye, { color: theme.ink3 }]}>COMING UP</Text>
                <Text style={[styles.sectionTitle, { color: theme.ink }]}>This week</Text>
              </View>
              <Pressable onPress={() => nav.navigate('MainTabs', { screen: 'Calendar' } as any)}>
                <Text style={[styles.seeAll, { color: theme.ink2 }]}>See all</Text>
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 20, gap: 8 }}>
              {weekPeek.map((appt) => (
                <WeekPeekRow key={appt.id} appt={appt} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ApptCard({ appt, isNext }: { appt: Appointment; isNext: boolean }) {
  const { theme, clients, products, setProducts, setAppointments, remindersEnabled } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const client = clients.find((c) => c.id === appt.clientId);

  const handleQuickAction = async () => {
    const idx = await dialog.actionSheet({
      title: appt.service,
      message: fmt.currency(appt.price),
      actions: [{ label: 'Mark complete' }, { label: 'Mark as no-show', destructive: true }],
    });
    if (idx === null || appt.status !== 'upcoming') return;
    if (idx === 1) {
      setAppointments((prev) => prev.map((a) =>
        a.id === appt.id ? { ...a, status: 'no-show' } : a
      ));
      return;
    }
    if (remindersEnabled) {
      appt.products.forEach((ap) => {
        const product = products.find((p) => p.id === ap.productId);
        if (!product) return;
        const after = deductStock(product, ap.amount);
        if (after.status !== 'ok' && after.status !== product.status) {
          notifyLowStock(product.name, after.status === 'out');
        }
      });
    }
    setProducts((prev) => prev.map((p) => {
      const used = appt.products.find((ap) => ap.productId === p.id);
      return used ? deductStock(p, used.amount) : p;
    }));
    setAppointments((prev) => prev.map((a) =>
      a.id === appt.id ? { ...a, status: 'completed' } : a
    ));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleQuickUndo = async () => {
    const ok = await dialog.confirm({
      title: 'Undo completion?',
      message: 'This marks the appointment upcoming again and restores product stock.',
      confirmLabel: 'Undo',
    });
    if (!ok) return;
    if (appt.status !== 'completed') return;
    setProducts((prev) => prev.map((p) => {
      const used = appt.products.find((ap) => ap.productId === p.id);
      return used ? restoreStock(p, used.amount) : p;
    }));
    setAppointments((prev) => prev.map((a) =>
      a.id === appt.id ? { ...a, status: 'upcoming' } : a
    ));
  };

  return (
    <Pressable
      onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
      style={({ pressed }) => [
        styles.apptCard,
        {
          backgroundColor: isNext ? theme.accent + '15' : theme.card,
          borderColor: isNext ? theme.accent + '50' : theme.line,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {/* Time column */}
      <View style={styles.apptTime}>
        <Text style={[styles.apptHour, { color: theme.ink }]}>{timeHour(appt.start)}</Text>
        <Text style={[styles.apptAmPm, { color: theme.ink3 }]}>{timeAmPm(appt.start)}</Text>
      </View>
      {/* Divider */}
      <View style={[styles.apptDivider, { backgroundColor: theme.line }]} />
      {/* Avatar */}
      {client && <Avatar name={client.name} tone={client.tone} size={38} />}
      {/* Info */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.apptName, { color: theme.ink }]} numberOfLines={1}>{client?.name}</Text>
        <Text style={[styles.apptService, { color: theme.ink2 }]} numberOfLines={1}>{appt.service}</Text>
        {appt.status === 'completed' && !appt.paid && (
          <Text style={[styles.unpaidTag, { color: theme.warn }]}>UNPAID</Text>
        )}
      </View>
      {/* Next badge */}
      {isNext && (
        <View style={[styles.nextBadge, { backgroundColor: theme.bg, borderColor: theme.accent + '30' }]}>
          <Text style={[styles.nextBadgeText, { color: theme.accent }]}>NEXT</Text>
        </View>
      )}
      {/* Quick complete */}
      {appt.status === 'upcoming' && (
        <Pressable
          onPress={handleQuickAction}
          hitSlop={8}
          style={[styles.quickCheck, { backgroundColor: theme.bg2, borderColor: theme.line }]}
        >
          <Icons.check size={14} color={theme.ink2} strokeWidth={2} />
        </Pressable>
      )}
      {/* Completed — tap to undo */}
      {appt.status === 'completed' && (
        <Pressable
          onPress={handleQuickUndo}
          hitSlop={8}
          style={[styles.quickCheck, { backgroundColor: theme.sage + '25', borderColor: theme.sage + '40' }]}
        >
          <Icons.check size={14} color={theme.sage} strokeWidth={2} />
        </Pressable>
      )}
    </Pressable>
  );
}

function WeekPeekRow({ appt }: { appt: Appointment }) {
  const { theme, clients } = useApp();
  const nav = useNavigation<Nav>();
  const client = clients.find((c) => c.id === appt.clientId);

  return (
    <Pressable
      onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
      style={({ pressed }) => [
        styles.weekRow,
        { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={{ width: 50, flexShrink: 0 }}>
        <Text style={[styles.weekRel, { color: theme.ink3 }]}>{fmt.rel(appt.start).toUpperCase()}</Text>
        <Text style={[styles.weekTime, { color: theme.ink }]}>{fmt.timeShort(appt.start)}</Text>
      </View>
      {client && <Avatar name={client.name} tone={client.tone} size={32} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.weekName, { color: theme.ink }]} numberOfLines={1}>{client?.name}</Text>
        <Text style={[styles.weekService, { color: theme.ink2 }]} numberOfLines={1}>{appt.service}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500', marginBottom: 8 },
  greeting: { fontSize: 30, fontWeight: '500', letterSpacing: -0.5, lineHeight: 36 },

  // Hero card
  heroCard: {
    borderRadius: 20,
    padding: 20,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  heroEyebrow: {
    fontFamily: 'System',
    fontSize: 10,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 6,
    fontWeight: '500',
  },
  heroAppts: {
    fontSize: 28,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -0.3,
    lineHeight: 32,
  },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  heroStats: { flexDirection: 'row', gap: 8 },
  heroStat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 12,
  },
  heroStatLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 2,
    fontWeight: '500',
  },
  heroStatVal: {
    fontSize: 20,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -0.3,
  },

  // Alert card
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 14,
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  alertTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertSub: { fontSize: 12 },

  // Section head
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionEye: { fontSize: 10, letterSpacing: 1.4, fontWeight: '400', marginBottom: 4 },
  sectionTitle: { fontSize: 22, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.3 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 2 },
  newBtnText: { fontSize: 13, fontWeight: '500' },
  seeAll: { fontSize: 13, paddingBottom: 2 },

  // Empty state
  emptyDay: { borderRadius: 16, padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, fontStyle: 'italic' },

  // Appointment card
  apptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 14,
  },
  apptTime: { width: 36, alignItems: 'center', flexShrink: 0 },
  apptHour: { fontSize: 22, fontWeight: '500', lineHeight: 24, letterSpacing: -0.5 },
  apptAmPm: { fontSize: 9, letterSpacing: 1, fontWeight: '500', marginTop: 2 },
  apptDivider: { width: 0.5, alignSelf: 'stretch' },
  apptName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  apptService: { fontSize: 12 },
  unpaidTag: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 3 },
  nextBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  nextBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  quickCheck: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Week peek
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 0.5,
  },
  weekRel: { fontSize: 9, letterSpacing: 1, fontWeight: '500', marginBottom: 2 },
  weekTime: { fontSize: 15, fontWeight: '500' },
  weekName: { fontSize: 13, fontWeight: '500' },
  weekService: { fontSize: 11, marginTop: 1 },
});
