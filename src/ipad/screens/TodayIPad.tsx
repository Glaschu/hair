import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useApp } from '../../data/AppContext';
import { useDialog } from '../../data/DialogContext';
import { useResponsive } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';
import { Avatar, Icons, RoundBtn } from '../../components';
import { fmt, addDays } from '../../data/utils';
import { deductStock } from '../../data/stock';
import { notifyLowStock } from '../../data/notifications';
import { Appointment } from '../../data/types';
import { Eyebrow, Title, Btn, StatTile } from '../ui';
import { useShell } from '../shellContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function greetingFor(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function TodayIPad() {
  const { theme, appointments, products, studioName } = useApp();
  const { isLandscape } = useResponsive();
  const { setSection, setClientMode } = useShell();
  const nav = useNavigation<Nav>();

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const tomorrow = useMemo(() => addDays(today, 1), [today]);
  const now = new Date();

  const todayAppts = useMemo(() =>
    appointments
      .filter((a) => { const d = new Date(a.start); return d >= today && d < tomorrow; })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, today, tomorrow]);

  const lowStock = products.filter((p) => p.status === 'low' || p.status === 'out');
  const nextApptId = todayAppts.find((a) => a.status === 'upcoming' && new Date(a.start) > now)?.id;

  const totalRevenue = todayAppts.reduce((s, a) => s + a.price, 0);
  const totalHours = todayAppts.reduce((s, a) =>
    s + (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000, 0);

  const weekEnd = useMemo(() => addDays(today, 7), [today]);
  const upcomingWeek = useMemo(() =>
    appointments
      .filter((a) => { const d = new Date(a.start); return d > tomorrow && d <= weekEnd && a.status === 'upcoming'; })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, tomorrow, weekEnd]);
  const weekPeek = upcomingWeek.slice(0, 4);
  const bookedAhead = appointments
    .filter((a) => { const d = new Date(a.start); return d > now && d <= weekEnd && a.status === 'upcoming'; })
    .reduce((s, a) => s + a.price, 0);

  // This-week forecast: predicted product cost + appointment count over the next 7 days.
  const weekForecast = useMemo(() => {
    const weekAppts = appointments.filter((a) => {
      const d = new Date(a.start);
      return a.status === 'upcoming' && d >= now && d <= weekEnd;
    });
    const cost = weekAppts.reduce((sum, a) =>
      sum + a.products.reduce((s, ap) => {
        const p = products.find((x) => x.id === ap.productId);
        return p ? s + p.cost * (ap.amount / p.size) : s;
      }, 0), 0);
    return { cost, count: weekAppts.length };
  }, [appointments, products, now, weekEnd]);

  // Busiest day of the current week (Mon–Sun) from the booked appointments.
  const weekBars = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
    appointments.forEach((a) => {
      const d = new Date(a.start);
      if (d >= today && d <= weekEnd) {
        const idx = (d.getDay() + 6) % 7;
        counts[idx]++;
      }
    });
    return counts;
  }, [appointments, today, weekEnd]);
  const maxBar = Math.max(1, ...weekBars);
  const busiestIdx = weekBars.indexOf(Math.max(...weekBars));
  const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const greeting = (
    <View style={styles.headerRow}>
      <View style={{ flex: 1 }}>
        <Eyebrow>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</Eyebrow>
        <Title size={isLandscape ? 40 : 34} style={{ marginTop: 4 }}>
          {greetingFor()}, <Text style={{ fontWeight: '400' }}>{studioName}</Text>
        </Title>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Lock toggle — enters Room mode (rendered by IPadShell when clientMode). */}
        <RoundBtn size={40} onPress={() => setClientMode(true)}>
          <Icons.lock size={18} color={theme.ink2} />
        </RoundBtn>
        <RoundBtn size={40} onPress={() => setSection('settings')}><Icons.settings size={18} color={theme.ink2} /></RoundBtn>
        <Btn variant="primary" icon={<Icons.plus size={16} color="#fff" />} onPress={() => nav.navigate('NewAppointment', {})}>New booking</Btn>
      </View>
    </View>
  );

  const hero = (
    <DayHero
      count={todayAppts.length}
      revenue={fmt.currency(totalRevenue)}
      hours={`${totalHours.toFixed(1)}h`}
      bookedAhead={fmt.currency(bookedAhead)}
      onReports={() => setSection('reports')}
    />
  );

  const restock = lowStock.length > 0 ? (
    <RestockBanner
      count={lowStock.length}
      names={lowStock.slice(0, 2).map((p) => p.name).join(', ') + (lowStock.length > 2 ? ` + ${lowStock.length - 2} more` : '')}
      onPress={() => setSection('inventory')}
    />
  ) : null;

  const scheduleHead = (
    <View style={styles.sectionHead}>
      <View style={{ flex: 1 }}>
        <Eyebrow>THE DAY</Eyebrow>
        <Title size={26} style={{ marginTop: 2 }}>Schedule</Title>
      </View>
      <Pressable onPress={() => nav.navigate('NewAppointment', {})} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icons.plus size={14} color={theme.accent} strokeWidth={2} />
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '500' }}>New</Text>
      </Pressable>
    </View>
  );

  const scheduleList = (
    <View style={{ gap: 10 }}>
      {todayAppts.length === 0 ? (
        <View style={[styles.emptyDay, { borderColor: theme.line }]}>
          <Text style={{ color: theme.ink3, fontSize: 14, fontStyle: 'italic', textAlign: 'center' }}>
            No appointments today — your day is free.
          </Text>
        </View>
      ) : (
        todayAppts.map((a) => <IPadApptRow key={a.id} appt={a} isNext={a.id === nextApptId} />)
      )}
    </View>
  );

  const comingUp = weekPeek.length > 0 ? (
    <View style={{ gap: 8 }}>
      <View style={[styles.sectionHead, { marginBottom: 4 }]}>
        <Eyebrow style={{ flex: 1 }}>COMING UP</Eyebrow>
        <Pressable onPress={() => setSection('calendar')}>
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '500' }}>See all</Text>
        </Pressable>
      </View>
      {weekPeek.map((a) => <UpcomingRow key={a.id} appt={a} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })} />)}
    </View>
  ) : null;

  const forecastCard = (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <Eyebrow>THIS WEEK · FORECAST</Eyebrow>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.bigStat, { color: theme.ink }]}>{fmt.currency(weekForecast.cost)}</Text>
          <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 4 }}>product cost</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.bigStat, { color: theme.sage }]}>{weekForecast.count}</Text>
          <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 4 }}>appointments</Text>
        </View>
      </View>
    </View>
  );

  const busiestCard = (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Eyebrow style={{ flex: 1 }}>BUSIEST DAY</Eyebrow>
        <Icons.trend size={16} color={theme.sage} />
      </View>
      <Text style={{ marginTop: 6, fontSize: 22, fontWeight: '500', fontStyle: 'italic', color: theme.ink }}>
        {maxBar > 0 ? DAY_FULL[busiestIdx] : '—'}
        <Text style={{ fontStyle: 'normal', fontWeight: '500', fontSize: 14, color: theme.ink3 }}>
          {maxBar > 0 ? ` · ${weekBars[busiestIdx]} appt${weekBars[busiestIdx] > 1 ? 's' : ''}` : ' · quiet week'}
        </Text>
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 5, marginTop: 14 }}>
        {weekBars.map((h, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(5, (h / maxBar) * 44), borderRadius: 3, backgroundColor: i === busiestIdx && maxBar > 0 ? theme.accent : theme.accent + '33' }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {DAY_LABELS.map((d) => <Text key={d} style={{ fontSize: 10, letterSpacing: 0.5, color: theme.ink3 }}>{d}</Text>)}
      </View>
    </View>
  );

  if (isLandscape) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 32, paddingTop: 18, paddingBottom: 8 }}>{greeting}</View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 32, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          {hero}
          <View style={{ flexDirection: 'row', gap: 20, marginTop: 20 }}>
            <View style={{ flex: 1.4, gap: 12 }}>
              {scheduleHead}
              {scheduleList}
              {comingUp}
            </View>
            <View style={{ flex: 1, gap: 16 }}>
              {restock}
              {forecastCard}
              {busiestCard}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Portrait — stacked single column
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 28, paddingTop: 16, paddingBottom: 4 }}>{greeting}</View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: 28, gap: 16 }} showsVerticalScrollIndicator={false}>
        {hero}
        {restock}
        <View>{scheduleHead}{scheduleList}</View>
        <View style={{ flexDirection: 'row', gap: 16 }}>{forecastCard}{busiestCard}</View>
        {comingUp}
      </ScrollView>
    </View>
  );
}

// ──────────────── Day-at-a-glance hero ────────────────
function DayHero({ count, revenue, hours, bookedAhead, onReports }: {
  count: number; revenue: string; hours: string; bookedAhead: string; onReports: () => void;
}) {
  const { theme } = useApp();
  return (
    <View style={[styles.hero, { backgroundColor: theme.heroBg }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroEyebrow}>DAY AT A GLANCE</Text>
          <Text style={styles.heroTitle}>
            {count} <Text style={{ fontWeight: '400', fontStyle: 'italic', opacity: 0.7 }}>appointment{count === 1 ? '' : 's'}</Text>
          </Text>
        </View>
        <View style={[styles.heroIcon, { backgroundColor: theme.accent }]}>
          <Icons.scissors size={22} color="#fff" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
        <StatTile dark label="Revenue" value={revenue} />
        <StatTile dark label="Hours" value={hours} />
        <StatTile dark label="Booked ahead" value={bookedAhead} sub="next 7 days" />
        <Pressable style={{ flex: 1 }} onPress={onReports}>
          <StatTile dark label="Reports" value={<Icons.arrowRight size={22} color="#fff" />} sub="View →" />
        </Pressable>
      </View>
    </View>
  );
}

function RestockBanner({ count, names, onPress }: { count: number; names: string; onPress: () => void }) {
  const { theme } = useApp();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.restock, { backgroundColor: theme.accent + '1A', opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.restockIcon, { backgroundColor: theme.accent }]}><Icons.alert size={20} color="#fff" /></View>
      <View style={{ flex: 1, minWidth: 0 }} pointerEvents="none">
        <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>{count} product{count === 1 ? '' : 's'} need restocking</Text>
        <Text style={{ fontSize: 13, color: theme.ink2, marginTop: 1 }} numberOfLines={1}>{names}</Text>
      </View>
      <Icons.chevronRight size={18} color={theme.ink2} />
    </Pressable>
  );
}

function UpcomingRow({ appt, onPress }: { appt: Appointment; onPress: () => void }) {
  const { theme, clients } = useApp();
  const client = clients.find((c) => c.id === appt.clientId);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.upRow, { backgroundColor: pressed ? theme.bg2 : theme.card, borderColor: theme.line }]}>
      <View style={{ width: 80 }}>
        <Text style={{ fontSize: 10, letterSpacing: 1, fontWeight: '500', color: theme.ink3 }}>{fmt.rel(appt.start).toUpperCase()}</Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.ink, marginTop: 2 }}>{fmt.timeShort(appt.start)}</Text>
      </View>
      {client && <Avatar name={client.name} tone={client.tone} size={34} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '600', fontSize: 14, color: theme.ink }} numberOfLines={1}>{client?.name}</Text>
        <Text style={{ fontSize: 12, color: theme.ink2 }} numberOfLines={1}>{appt.service}</Text>
      </View>
    </Pressable>
  );
}

// ──────────────── Schedule row with action bar ────────────────
function IPadApptRow({ appt, isNext }: { appt: Appointment; isNext: boolean }) {
  const { theme, clients, products, setProducts, setAppointments, remindersEnabled } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const client = clients.find((c) => c.id === appt.clientId);
  const d = new Date(appt.start);
  const hour = d.getHours() % 12 || 12;
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  const completed = appt.status === 'completed';
  const noShow = appt.status === 'no-show';
  const pale = isNext || completed;
  const showActions = isNext && appt.status === 'upcoming';

  const complete = () => {
    if (appt.status !== 'upcoming') return;
    if (remindersEnabled) {
      appt.products.forEach((ap) => {
        const product = products.find((p) => p.id === ap.productId);
        if (!product) return;
        const after = deductStock(product, ap.amount);
        if (after.status !== 'ok' && after.status !== product.status) notifyLowStock(product.name, after.status === 'out');
      });
    }
    setProducts((prev) => prev.map((p) => {
      const used = appt.products.find((ap) => ap.productId === p.id);
      return used ? deductStock(p, used.amount) : p;
    }));
    setAppointments((prev) => prev.map((a) => a.id === appt.id ? { ...a, status: 'completed' } : a));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const noShowAction = async () => {
    const ok = await dialog.confirm({ title: 'Mark as no-show?', message: `${client?.name ?? 'This client'} didn't show for ${appt.service}.`, confirmLabel: 'No-show', tone: 'destructive' });
    if (ok) setAppointments((prev) => prev.map((a) => a.id === appt.id ? { ...a, status: 'no-show' } : a));
  };

  return (
    <View style={[styles.apptRow, { backgroundColor: pale ? theme.accent + '14' : theme.card, borderColor: isNext ? theme.accent + '40' : theme.line }]}>
      <Pressable onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })} style={[styles.apptMain, { backgroundColor: 'transparent' }]}>
        <View style={{ width: 54 }} pointerEvents="none">
          <Text style={{ fontSize: 22, fontWeight: '500', fontStyle: 'italic', color: theme.ink, lineHeight: 24 }}>{hour}</Text>
          <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.ink3, fontWeight: '500' }}>{ampm}</Text>
        </View>
        <View pointerEvents="none">{client && <Avatar name={client.name} tone={client.tone} size={38} />}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }} numberOfLines={1}>{client?.name}</Text>
          <Text style={{ fontSize: 13, color: theme.ink2 }} numberOfLines={1}>{appt.service} · {fmt.duration(Math.round((new Date(appt.end).getTime() - d.getTime()) / 60000))}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} pointerEvents="none">
          {isNext && (
            <View style={[styles.nextBadge, { backgroundColor: theme.card, borderColor: theme.accent + '40' }]}>
              <Text style={{ fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: theme.accent }}>NEXT</Text>
            </View>
          )}
          <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>{fmt.currency(appt.price)}</Text>
          {completed ? <Icons.check size={20} color={theme.sage} strokeWidth={2} />
            : noShow ? <Text style={{ fontSize: 10, fontWeight: '700', color: theme.danger, letterSpacing: 0.5 }}>NO SHOW</Text>
            : <Icons.chevronRight size={18} color={theme.ink3} />}
        </View>
      </Pressable>
      {showActions && (
        <View style={[styles.actionBar, { borderTopColor: theme.accent + '33' }]}>
          <Btn compact variant="soft" icon={<Icons.clock size={14} color={theme.ink2} />} onPress={() => nav.navigate('RescheduleModal', { appointmentId: appt.id })}>Reschedule</Btn>
          <Btn compact variant="soft" icon={<Icons.edit size={14} color={theme.ink2} />} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}>Notes</Btn>
          <Btn compact variant="soft" textColor={theme.danger} icon={<Icons.close size={14} color={theme.danger} />} onPress={noShowAction}>No-show</Btn>
          <View style={{ flex: 1 }} />
          <Btn compact variant="dark" icon={<Icons.check size={14} color="#fff" />} onPress={complete}>Complete</Btn>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  hero: { borderRadius: 22, padding: 22 },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.4, color: 'rgba(255,255,255,0.55)', fontWeight: '500', marginBottom: 6 },
  heroTitle: { fontSize: 36, fontWeight: '500', color: '#fff', letterSpacing: -0.5, lineHeight: 40 },
  heroIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  restock: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16 },
  restockIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  card: { flex: 1, borderRadius: 16, borderWidth: 0.5, padding: 18 },
  bigStat: { fontSize: 32, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.5, lineHeight: 34 },
  emptyDay: { borderWidth: 1, borderRadius: 14, padding: 24 },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 0.5 },
  apptRow: { borderRadius: 16, borderWidth: 0.5, overflow: 'hidden' },
  apptMain: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  nextBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 0.5 },
  actionBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10, borderTopWidth: 1 },
});
