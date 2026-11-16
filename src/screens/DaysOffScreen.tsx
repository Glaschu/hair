import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn, useLocalDialog } from '../components';
import {
  dateKey, fromKey, upcomingDaysOff, describeDayOff, appointmentsOnDaysOff, newDayOffId as newId, type DayOff,
} from '../data/daysOff';
import { fmt } from '../data/utils';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Days off: a holiday, a course, a day she is ill.
 *
 * Tap the first day and the last (or one day twice), add a note if she likes,
 * block it off. From then on: never offered in a link, closed on both
 * calendars, and refused on her booking page even in links already sent.
 * Anything already booked on those days is shown to her — never cancelled for
 * her, because only she knows whether to move it, cancel it, or work anyway.
 */
export default function DaysOffScreen() {
  const { theme, daysOff, setDaysOff, appointments, clients } = useApp();
  const { confirm, alert, actionSheet, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();

  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [first, setFirst] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const upcoming = useMemo(() => upcomingDaysOff(daysOff), [daysOff]);
  const blocked = (key: string) => daysOff.some((d) => d.start <= key && key <= d.end);

  const cells = useMemo(() => {
    const lead = month.getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: lead + count }, (_, i) =>
      (i < lead ? null : new Date(month.getFullYear(), month.getMonth(), i - lead + 1)));
  }, [month]);

  const range = first ? (last && last < first ? { start: last, end: first } : { start: first, end: last ?? first }) : null;
  const inRange = (key: string) => !!range && range.start <= key && key <= range.end;
  const dayCount = range ? Math.round((fromKey(range.end).getTime() - fromKey(range.start).getTime()) / 86_400_000) + 1 : 0;

  const tap = (key: string) => {
    if (key < today) return;
    // First tap picks a day; a second picks the end of the break; a third
    // starts again.
    if (!first || last) { setFirst(key); setLast(null); return; }
    setLast(key);
  };

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'A client';

  const block = async () => {
    if (!range) return;
    const entry: DayOff = { id: newId(), start: range.start, end: range.end, ...(note.trim() ? { note: note.trim() } : {}) };
    setDaysOff((prev) => [...prev, entry]);
    setFirst(null); setLast(null); setNote('');

    // Never cancelled for her — but never left for her to stumble on, either.
    const booked = appointmentsOnDaysOff(appointments, [entry]);
    if (booked.length) {
      const lines = booked.slice(0, 6).map((a) =>
        `• ${clientName(a.clientId)} — ${new Date(a.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt.time(a.start)}`);
      const idx = await actionSheet({
        title: `${booked.length} appointment${booked.length > 1 ? 's are' : ' is'} still booked`,
        message: `${lines.join('\n')}${booked.length > 6 ? `\n…and ${booked.length - 6} more` : ''}\n\nThey haven't been changed. Open each one to move or cancel it.`,
        actions: [{ label: 'Open the first one' }],
        cancelLabel: 'Later',
      });
      if (idx === 0) nav.navigate('AppointmentDetail', { appointmentId: booked[0].id });
    }
  };

  const reopen = async (d: DayOff) => {
    const ok = await confirm({
      title: `Open ${describeDayOff(d)} again?`,
      message: 'Those days can be offered in links again, and times already in links you sent come back.',
      confirmLabel: 'Open again',
    });
    if (ok) setDaysOff((prev) => prev.filter((x) => x.id !== d.id));
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.header}>
        <RoundBtn label="Back" onPress={() => nav.goBack()}><Icons.chevronLeft size={20} color={theme.ink} /></RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>Days off</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
          A holiday, a course, a day you're ill. Days off are never offered in a booking link — and
          clients can't book them even from a link you've already sent.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <View style={styles.monthRow}>
            <Pressable accessibilityLabel="Previous month" hitSlop={10}
              onPress={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
              <Icons.chevronLeft size={20} color={theme.ink2} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: theme.ink }]}>{fmt.monthYr(month)}</Text>
            <Pressable accessibilityLabel="Next month" hitSlop={10}
              onPress={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
              <Icons.chevronRight size={20} color={theme.ink2} />
            </Pressable>
          </View>

          <View style={styles.grid}>
            {DAY_SHORT.map((d) => (
              <Text key={d} style={[styles.cell, styles.dow, { color: theme.ink3 }]}>{d}</Text>
            ))}
            {cells.map((day, i) => {
              if (!day) return <View key={`pad-${i}`} style={styles.cell} />;
              const key = dateKey(day);
              const past = key < today;
              const picked = inRange(key);
              const off = blocked(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => tap(key)}
                  disabled={past}
                  accessibilityLabel={`${day.toDateString()}${off ? ', already a day off' : ''}`}
                  style={styles.cell}
                >
                  <View style={[
                    styles.dayDot,
                    picked && { backgroundColor: theme.accent },
                    !picked && off && { backgroundColor: theme.ink3 + '22' },
                  ]}>
                    <Text style={{
                      fontSize: 14,
                      fontWeight: picked ? '700' : '500',
                      color: picked ? '#fff' : past ? theme.ink3 + '66' : off ? theme.ink3 : theme.ink,
                      textDecorationLine: off && !picked ? 'line-through' : 'none',
                    }}>
                      {day.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {range ? (
            <View style={{ gap: 10, marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: theme.ink }}>
                {describeDayOff(range)}{dayCount > 1 ? ` · ${dayCount} days` : ''}
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                maxLength={40}
                placeholder="Note (optional) — e.g. Holiday"
                placeholderTextColor={theme.ink3}
                style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.bg }]}
              />
              <Pressable onPress={block} style={[styles.primary, { backgroundColor: theme.heroBg }]}>
                <Text style={styles.primaryText}>{dayCount > 1 ? `Block off ${dayCount} days` : 'Block off this day'}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={{ fontSize: 13, color: theme.ink3, marginTop: 6 }}>
              Tap the first day off, then the last. For a single day, tap it twice.
            </Text>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={[styles.label, { color: theme.ink3 }]}>COMING UP</Text>
          {upcoming.length === 0 ? (
            <Text style={{ fontSize: 14, color: theme.ink3 }}>No days off booked.</Text>
          ) : upcoming.map((d) => (
            <View key={d.id} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: theme.ink }}>{describeDayOff(d)}</Text>
                {!!d.note && <Text style={{ fontSize: 13, color: theme.ink3, marginTop: 2 }}>{d.note}</Text>}
              </View>
              <Pressable onPress={() => reopen(d)} hitSlop={8}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent }}>Open again</Text>
              </Pressable>
            </View>
          ))}
        </View>
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
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  monthTitle: { fontSize: 16, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  dow: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  dayDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, fontSize: 15 },
  primary: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  label: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
});
