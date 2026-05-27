import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, FlatList, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Each weekday column is 1/7 of the row, so the grid always fits 7 across at any
// window width (phone, iPad, or a resizable Mac window).
const COL_W = '14.2857%' as const;
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Icons, RoundBtn } from '../components';
import { fmt, isSameDay, addDays, startOfWeek } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type CalView = 'day' | 'week' | 'month';

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const HOUR_START = 8;
const HOUR_END = 20;

const shiftMonth = (date: Date, offset: number) => {
  const d = new Date(date);
  const current = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const maxDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(current, maxDays));
  return d;
};

export default function CalendarScreen() {
  const { theme, appointments, clients, density } = useApp();
  const nav = useNavigation<Nav>();
  const [view, setView] = useState<CalView>('week');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const todayAppts = useMemo(() =>
    appointments.filter((a) => isSameDay(new Date(a.start), selectedDate))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, selectedDate]);

  const weekAppts = useMemo(() =>
    appointments.filter((a) => {
      const d = new Date(a.start);
      return d >= weekStart && d < addDays(weekStart, 7);
    }), [appointments, weekStart]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.eyebrow, { color: theme.ink3, marginBottom: 0 }]}>
              {fmt.monthYr(selectedDate).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.ink }]}>Calendar</Text>
        </View>
        {!isSameDay(selectedDate, new Date()) && (
          <Pressable
            onPress={() => setSelectedDate(new Date())}
            style={[styles.todayBtn, { backgroundColor: theme.accent + '18' }]}
          >
            <Text style={[styles.todayBtnText, { color: theme.accent }]}>Today</Text>
          </Pressable>
        )}
        <RoundBtn onPress={() => nav.navigate('NewAppointment', {})} filled size={40}>
          <Icons.plus size={18} color={theme.bg} />
        </RoundBtn>
      </View>

      {/* View toggle */}
      <View style={[styles.toggleRow, { backgroundColor: theme.bg2 }]}>
        {(['day', 'week', 'month'] as CalView[]).map((v) => (
          <Pressable
            key={v}
            onPress={() => setView(v)}
            style={[styles.toggleBtn, view === v && { backgroundColor: theme.card, borderRadius: 10 }]}
          >
            <Text style={[styles.toggleText, { color: view === v ? theme.ink : theme.ink3 }]}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Week strip */}
      {view !== 'month' && (
        <View style={styles.weekStrip}>
          <Pressable onPress={() => setSelectedDate(addDays(selectedDate, view === 'week' ? -7 : -1))}>
            <Icons.chevronLeft size={20} color={theme.ink2} />
          </Pressable>
          <View style={styles.weekDaysContainer}>
            {weekDays.map((day) => {
              const isSelected = isSameDay(day, selectedDate);
              const isToday = isSameDay(day, new Date());
              const dayAppts = appointments.filter((a) => isSameDay(new Date(a.start), day));
              return (
                <Pressable
                  key={day.toISOString()}
                  onPress={() => setSelectedDate(day)}
                  style={styles.dayBtn}
                >
                  <Text style={[styles.dayShort, { color: isSelected ? theme.accent : theme.ink3 }]}>
                    {DAY_SHORT[day.getDay()]}
                  </Text>
                  <View style={[
                    styles.dayNum,
                    isSelected && { backgroundColor: theme.accent },
                    isToday && !isSelected && { borderWidth: 1.5, borderColor: theme.accent },
                  ]}>
                    <Text style={[styles.dayNumText, { color: isSelected ? '#fff' : isToday ? theme.accent : theme.ink }]}>
                      {day.getDate()}
                    </Text>
                  </View>
                  {dayAppts.length > 0 && (
                    <View style={[styles.dot, { backgroundColor: isSelected ? '#fff' : theme.accent }]} />
                  )}
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => setSelectedDate(addDays(selectedDate, view === 'week' ? 7 : 1))}>
            <Icons.chevronRight size={20} color={theme.ink2} />
          </Pressable>
        </View>
      )}

      {/* Month strip */}
      {view === 'month' && (
        <View style={styles.weekStrip}>
          <Pressable onPress={() => setSelectedDate(shiftMonth(selectedDate, -1))}>
            <Icons.chevronLeft size={20} color={theme.ink2} />
          </Pressable>
          <View style={styles.weekDaysContainer}>
            {[-3, -2, -1, 0, 1, 2, 3].map((offset) => {
              const mDate = shiftMonth(selectedDate, offset);
              const isSelected = offset === 0;
              const isCurrentMonth = mDate.getMonth() === new Date().getMonth() && mDate.getFullYear() === new Date().getFullYear();
              return (
                <Pressable
                  key={offset}
                  onPress={() => setSelectedDate(mDate)}
                  style={styles.dayBtn}
                >
                  <Text style={[styles.dayShort, { color: isSelected ? theme.accent : theme.ink3 }]}>
                    '{mDate.getFullYear().toString().slice(2)}
                  </Text>
                  <View style={[
                    styles.dayNum,
                    { width: 36, borderRadius: 18 },
                    isSelected && { backgroundColor: theme.accent },
                    isCurrentMonth && !isSelected && { borderWidth: 1.5, borderColor: theme.accent },
                  ]}>
                    <Text style={[styles.dayNumText, { fontSize: 12, color: isSelected ? '#fff' : isCurrentMonth ? theme.accent : theme.ink }]}>
                      {mDate.toLocaleDateString('en-GB', { month: 'short' })}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => setSelectedDate(shiftMonth(selectedDate, 1))}>
            <Icons.chevronRight size={20} color={theme.ink2} />
          </Pressable>
        </View>
      )}

      {/* Day view content */}
      {view === 'day' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
          <DayHourGrid appts={todayAppts} date={selectedDate} density={density} />
        </ScrollView>
      )}

      {/* Week view */}
      {view === 'week' && (
        <View style={{ flex: 1 }}>
          <WeekView days={weekDays} allAppts={weekAppts} selectedDate={selectedDate} onSelectDay={setSelectedDate} density={density} />
        </View>
      )}

      {/* Month view — appointment list for selected day */}
      {view === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          appts={appointments}
        />
      )}
    </SafeAreaView>
  );
}

function DayHourGrid({ appts, date, density }: { appts: any[]; date: Date; density: string }) {
  const { theme, clients } = useApp();
  const nav = useNavigation<Nav>();
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const HOUR_HEIGHT = density === 'compact' ? 36 : density === 'comfy' ? 72 : 52;

  const now = new Date();
  const isToday = isSameDay(date, now);
  const nowOffset = isToday
    ? ((now.getHours() - HOUR_START) + now.getMinutes() / 60) * HOUR_HEIGHT
    : -1;

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
      <View style={{ position: 'relative' }}>
        {hours.map((h) => (
          <View key={h} style={{ height: HOUR_HEIGHT, flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={[styles.hourLabel, { color: theme.ink3 }]}>
              {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
            </Text>
            <View style={[styles.hourLine, { backgroundColor: theme.line }]} />
          </View>
        ))}

        {/* Appointment blocks */}
        <View style={StyleSheet.absoluteFillObject}>
          {appts.map((appt) => {
            const s = new Date(appt.start);
            const e = new Date(appt.end);
            const top = ((s.getHours() - HOUR_START) + s.getMinutes() / 60) * HOUR_HEIGHT;
            const height = ((e.getTime() - s.getTime()) / 3600000) * HOUR_HEIGHT;
            const client = clients.find((c) => c.id === appt.clientId);
            return (
              <Pressable
                key={appt.id}
                onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
                style={[styles.apptBlock, {
                  top, height: Math.max(height, 36),
                  left: 48, right: 0,
                  backgroundColor: theme.accent + '25',
                  borderColor: theme.accent,
                }]}
              >
                <Text style={[styles.blockName, { color: theme.ink }]} numberOfLines={1}>
                  {client?.name || appt.service}
                </Text>
                <Text style={[styles.blockService, { color: theme.ink2 }]} numberOfLines={1}>{appt.service}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Now line */}
        {isToday && nowOffset > 0 && (
          <View style={[styles.nowLine, { top: nowOffset, backgroundColor: theme.accent }]} />
        )}
      </View>
    </View>
  );
}

function WeekView({ days, allAppts, selectedDate, onSelectDay, density: _density }: { days: Date[]; allAppts: any[]; selectedDate: Date; onSelectDay: (d: Date) => void; density: string }) {
  const { theme, clients } = useApp();
  const nav = useNavigation<Nav>();
  const listRef = React.useRef<FlatList>(null);

  React.useEffect(() => {
    const index = days.findIndex(d => isSameDay(d, selectedDate));
    if (index >= 0 && listRef.current) {
      listRef.current.scrollToIndex({ index, animated: true, viewPosition: 0 });
    }
  }, [selectedDate, days]);

  const renderItem = ({ item: day }: { item: Date }) => {
    const dayAppts = allAppts
      .filter((a) => isSameDay(new Date(a.start), day))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const isToday = isSameDay(day, new Date());

    return (
      <View style={styles.weekDaySection}>
        <Pressable onPress={() => onSelectDay(day)} style={styles.weekDayHead}>
          <Text style={[styles.weekDayLabel, {
            color: isToday ? theme.accent : theme.ink2,
            fontWeight: isToday ? '700' : '500',
          }]}>
            {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </Text>
          {dayAppts.length > 0 && (
            <Text style={[styles.weekDayCount, { color: theme.ink3 }]}>{dayAppts.length} appt{dayAppts.length > 1 ? 's' : ''}</Text>
          )}
        </Pressable>
        {dayAppts.length === 0 ? (
          <View style={[styles.weekEmpty, { borderColor: theme.line }]}>
            <Text style={[styles.weekEmptyText, { color: theme.ink3 }]}>Free</Text>
          </View>
        ) : (
          dayAppts.map((appt) => {
            const client = clients.find((c) => c.id === appt.clientId);
            return (
              <Pressable
                key={appt.id}
                onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
                style={({ pressed }) => [styles.weekAppt, {
                  backgroundColor: pressed ? theme.bg2 : theme.card,
                  borderColor: theme.line,
                }]}
              >
                {client && <Avatar name={client.name} tone={client.tone} size={34} />}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.weekApptName, { color: theme.ink }]}>{client?.name}</Text>
                  <Text style={[styles.weekApptSvc, { color: theme.ink2 }]}>{appt.service}</Text>
                </View>
                <Text style={[styles.weekApptTime, { color: theme.ink3 }]}>{fmt.timeShort(appt.start)}</Text>
              </Pressable>
            );
          })
        )}
      </View>
    );
  };

  return (
    <FlatList
      ref={listRef}
      data={days}
      keyExtractor={(d) => d.toISOString()}
      contentContainerStyle={{ paddingTop: 10, paddingBottom: 30 }}
      showsVerticalScrollIndicator={false}
      renderItem={renderItem}
      onScrollToIndexFailed={(info) => {
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: info.index, animated: true });
        }, 100);
      }}
    />
  );
}

function MonthView({ selectedDate, onSelectDate, appts }: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  appts: any[];
}) {
  const { theme, clients } = useApp();
  const nav = useNavigation<Nav>();

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : new Date(year, month, i - firstDay + 1)
  );

  const dayAppts = appts.filter((a) => isSameDay(new Date(a.start), selectedDate));

  return (
    <View style={{ flex: 1 }}>
      {/* Calendar grid */}
      <View style={styles.monthGrid}>
        {DAY_SHORT.map((d) => (
          <Text key={d} style={[styles.monthDayName, { color: theme.ink3 }]}>{d}</Text>
        ))}
        {cells.map((day, i) => {
          if (!day) return <View key={`e${i}`} style={styles.monthCell} />;
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());
          const hasAppts = appts.some((a) => isSameDay(new Date(a.start), day));
          return (
            <Pressable
              key={day.toISOString()}
              onPress={() => onSelectDate(day)}
              style={styles.monthCell}
            >
              <View style={[
                styles.monthDayNum,
                isSelected && { backgroundColor: theme.accent },
                isToday && !isSelected && { borderWidth: 1.5, borderColor: theme.accent },
              ]}>
                <Text style={[styles.monthCellText, {
                  color: isSelected ? '#fff' : isToday ? theme.accent : theme.ink,
                  fontWeight: isToday || isSelected ? '700' : '400',
                }]}>
                  {day.getDate()}
                </Text>
              </View>
              {hasAppts && (
                <View style={[styles.monthDot, { backgroundColor: isSelected ? '#fff' : theme.accent }]} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Selected day appts */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
        <Text style={[styles.monthDayTitle, { color: theme.ink3 }]}>
          {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
        </Text>
        {dayAppts.length === 0 ? (
          <Text style={[styles.noAppts, { color: theme.ink3 }]}>No appointments</Text>
        ) : (
          dayAppts
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
            .map((appt) => {
              const client = clients.find((c) => c.id === appt.clientId);
              return (
                <Pressable
                  key={appt.id}
                  onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
                  style={({ pressed }) => [styles.monthAppt, {
                    backgroundColor: pressed ? theme.bg2 : theme.card,
                    borderColor: theme.line,
                  }]}
                >
                  {client && <Avatar name={client.name} tone={client.tone} size={36} />}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.weekApptName, { color: theme.ink }]}>{client?.name}</Text>
                    <Text style={[styles.weekApptSvc, { color: theme.ink2 }]}>{appt.service} · {fmt.timeShort(appt.start)}</Text>
                  </View>
                  <Icons.chevronRight size={16} color={theme.ink3} />
                </Pressable>
              );
            })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  title: { fontSize: 34, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.5 },
  todayBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, marginRight: 10 },
  todayBtnText: { fontSize: 13, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 12, padding: 3, borderRadius: 12 },
  toggleBtn: { flex: 1, paddingVertical: 7, alignItems: 'center' },
  toggleText: { fontSize: 13, fontWeight: '600' },
  weekStrip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  weekDaysContainer: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 8 },
  dayBtn: { flex: 1, alignItems: 'center', height: 60, paddingTop: 4 },
  dayShort: { fontSize: 10, fontWeight: '500', marginBottom: 3 },
  dayNum: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dayNumText: { fontSize: 14, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 4 },
  hourLabel: { width: 40, fontSize: 11, paddingTop: 2, fontWeight: '500' },
  hourLine: { flex: 1, height: 0.5, marginTop: 10 },
  apptBlock: {
    position: 'absolute', borderLeftWidth: 3, borderRadius: 8,
    padding: 6, overflow: 'hidden',
  },
  blockName: { fontSize: 12, fontWeight: '700' },
  blockService: { fontSize: 11 },
  nowLine: { position: 'absolute', left: 48, right: 0, height: 2, borderRadius: 1 },
  weekDaySection: { paddingHorizontal: 20, marginBottom: 16 },
  weekDayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  weekDayLabel: { fontSize: 13, letterSpacing: 0.2 },
  weekDayCount: { fontSize: 12 },
  weekEmpty: { borderWidth: 0.5, borderRadius: 12, padding: 12, alignItems: 'center' },
  weekEmptyText: { fontSize: 13, fontStyle: 'italic' },
  weekAppt: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderRadius: 14,
    padding: 12, marginBottom: 8,
  },
  weekApptName: { fontSize: 14, fontWeight: '600' },
  weekApptSvc: { fontSize: 12, marginTop: 1 },
  weekApptTime: { fontSize: 13, fontWeight: '500' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingVertical: 8 },
  monthDayName: { width: COL_W, textAlign: 'center', fontSize: 11, fontWeight: '600', paddingVertical: 4 },
  monthCell: { width: COL_W, height: 48, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  monthDayNum: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  monthCellText: { fontSize: 14 },
  monthDot: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 4 },
  monthDayTitle: { fontSize: 10, letterSpacing: 1.4, marginBottom: 12, fontWeight: '600' },
  noAppts: { fontSize: 14, fontStyle: 'italic' },
  monthAppt: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderRadius: 14,
    padding: 12, marginBottom: 8,
  },
});
