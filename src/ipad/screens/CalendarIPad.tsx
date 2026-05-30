import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../../data/AppContext';
import { useResponsive } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';
import { Avatar, Icons, RoundBtn } from '../../components';
import { fmt, isSameDay, addDays, startOfWeek } from '../../data/utils';
import { Appointment, Schedule } from '../../data/types';

/** Configured open hours for a date's weekday (0 when closed/unset). */
function dayOpenHours(schedule: Schedule, d: Date): number {
  const s = schedule[d.getDay()];
  if (!s || !s.open) return 0;
  const [sh, sm] = s.start.split(':').map(Number);
  const [eh, em] = s.end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}
import { Eyebrow, Title, Btn } from '../ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type CalView = 'day' | 'week' | 'month';

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const HOUR_START = 8;
const HOUR_END = 20;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

export function CalendarIPad() {
  const { theme, appointments, density, schedule } = useApp();
  const { isLandscape } = useResponsive();
  const nav = useNavigation<Nav>();
  const [view, setView] = useState<CalView>('week');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekAppts = useMemo(() =>
    appointments.filter((a) => { const d = new Date(a.start); return d >= weekStart && d < addDays(weekStart, 7); }),
    [appointments, weekStart]);
  const dayAppts = useMemo(() =>
    appointments.filter((a) => isSameDay(new Date(a.start), selectedDate)).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, selectedDate]);

  // Summary adapts to the active view: Day / Week / Month period + its open hours.
  const summary = useMemo(() => {
    if (view === 'day') {
      return { label: 'Day summary', appts: dayAppts, openHours: dayOpenHours(schedule, selectedDate) };
    }
    if (view === 'month') {
      const m = selectedDate.getMonth(), y = selectedDate.getFullYear();
      const appts = appointments.filter((a) => { const d = new Date(a.start); return d.getMonth() === m && d.getFullYear() === y; });
      const days = new Date(y, m + 1, 0).getDate();
      let openHours = 0;
      for (let i = 1; i <= days; i++) openHours += dayOpenHours(schedule, new Date(y, m, i));
      return { label: 'Month summary', appts, openHours };
    }
    const openHours = weekDays.reduce((s, d) => s + dayOpenHours(schedule, d), 0);
    return { label: 'Week summary', appts: weekAppts, openHours };
  }, [view, dayAppts, weekAppts, weekDays, selectedDate, appointments, schedule]);

  const hourHeight = density === 'compact' ? 46 : density === 'comfy' ? 72 : 58;

  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Eyebrow>{fmt.monthYr(selectedDate).toUpperCase()}</Eyebrow>
        <Title size={isLandscape ? 34 : 30} style={{ marginTop: 2 }}>Calendar</Title>
      </View>
      <View style={[styles.toggle, { backgroundColor: theme.bg2 }]}>
        {(['day', 'week', 'month'] as CalView[]).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} style={[styles.toggleBtn, view === v && { backgroundColor: theme.card }]}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: view === v ? theme.ink : theme.ink3 }}>{v[0].toUpperCase() + v.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {!isSameDay(selectedDate, new Date()) && <Btn compact onPress={() => setSelectedDate(new Date())}>Today</Btn>}
      <RoundBtn filled size={40} onPress={() => nav.navigate('NewAppointment', {})}><Icons.plus size={18} color={theme.bg} /></RoundBtn>
    </View>
  );

  const mainPane = (
    <View style={{ flex: 1, minWidth: 0 }}>
      {view === 'week' && <WeekGrid weekDays={weekDays} weekAppts={weekAppts} selectedDate={selectedDate} onSelectDay={setSelectedDate} hourHeight={hourHeight} onOpen={(id) => nav.navigate('AppointmentDetail', { appointmentId: id })} />}
      {view === 'day' && <DayGrid date={selectedDate} appts={dayAppts} hourHeight={hourHeight} onOpen={(id) => nav.navigate('AppointmentDetail', { appointmentId: id })} />}
      {view === 'month' && <MonthGrid selectedDate={selectedDate} onSelect={setSelectedDate} appts={appointments} />}
    </View>
  );

  const rightRail = (
    <View style={[styles.rail, isLandscape && { width: 320, borderLeftWidth: 0.5, borderLeftColor: theme.line }]}>
      <ScrollView contentContainerStyle={{ padding: 22, gap: 16 }} showsVerticalScrollIndicator={false}>
        <MiniMonth selectedDate={selectedDate} onSelect={setSelectedDate} appts={appointments} />
        <View>
          <Eyebrow style={{ marginBottom: 8 }}>
            {selectedDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · {dayAppts.length} APPT{dayAppts.length === 1 ? '' : 'S'}
          </Eyebrow>
          {dayAppts.length === 0 ? (
            <Text style={{ color: theme.ink3, fontStyle: 'italic', fontSize: 13 }}>Nothing booked.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {dayAppts.map((a) => <RailAppt key={a.id} appt={a} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })} />)}
            </View>
          )}
        </View>
        <PeriodSummary label={summary.label} appts={summary.appts} openHours={summary.openHours} />
      </ScrollView>
    </View>
  );

  if (!isLandscape) {
    // Portrait — single column; the Day/Week/Month toggle swaps the body.
    // The month grid appears only in Month mode; Day/Week get their own ‹ › nav.
    const stepHeader = (label: string, onPrev: () => void, onNext: () => void) => (
      <View style={styles.stepHeader}>
        <Pressable onPress={onPrev} hitSlop={8}><Icons.chevronLeft size={20} color={theme.ink2} /></Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: theme.ink }}>{label}</Text>
        <Pressable onPress={onNext} hitSlop={8}><Icons.chevronRight size={20} color={theme.ink2} /></Pressable>
      </View>
    );
    const dayList = dayAppts.length === 0
      ? <Text style={{ color: theme.ink3, fontStyle: 'italic', fontSize: 13 }}>Nothing booked.</Text>
      : <View style={{ gap: 8 }}>{dayAppts.map((a) => <RailAppt key={a.id} appt={a} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })} />)}</View>;
    const weekSection = (
      <View style={{ gap: 16 }}>
        {weekDays.map((d) => {
          const appts = weekAppts.filter((a) => isSameDay(new Date(a.start), d)).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
          const isToday = isSameDay(d, new Date());
          return (
            <View key={d.toISOString()}>
              <Pressable onPress={() => setSelectedDate(d)} style={{ marginBottom: 8 }}>
                <Eyebrow color={isToday ? theme.accent : undefined}>
                  {d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase()}{appts.length ? ` · ${appts.length}` : ''}
                </Eyebrow>
              </Pressable>
              {appts.length === 0
                ? <Text style={{ color: theme.ink3, fontStyle: 'italic', fontSize: 13 }}>Free</Text>
                : <View style={{ gap: 8 }}>{appts.map((a) => <RailAppt key={a.id} appt={a} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })} />)}</View>}
            </View>
          );
        })}
      </View>
    );
    const weekLabel = `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 28 }}>{header}</View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: 28, gap: 16 }} showsVerticalScrollIndicator={false}>
          {view === 'day' && (
            <>
              {stepHeader(selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), () => setSelectedDate(addDays(selectedDate, -1)), () => setSelectedDate(addDays(selectedDate, 1)))}
              {dayList}
            </>
          )}
          {view === 'week' && (
            <>
              {stepHeader(weekLabel, () => setSelectedDate(addDays(selectedDate, -7)), () => setSelectedDate(addDays(selectedDate, 7)))}
              {weekSection}
            </>
          )}
          {view === 'month' && (
            <>
              <MiniMonth selectedDate={selectedDate} onSelect={setSelectedDate} appts={appointments} />
              <View>
                <Eyebrow style={{ marginBottom: 8 }}>
                  {selectedDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · {dayAppts.length} APPT{dayAppts.length === 1 ? '' : 'S'}
                </Eyebrow>
                {dayList}
              </View>
            </>
          )}
          <PeriodSummary label={summary.label} appts={summary.appts} openHours={summary.openHours} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 32 }}>{header}</View>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {mainPane}
        {rightRail}
      </View>
    </View>
  );
}

function WeekGrid({ weekDays, weekAppts, selectedDate, onSelectDay, hourHeight, onOpen }: {
  weekDays: Date[]; weekAppts: Appointment[]; selectedDate: Date; onSelectDay: (d: Date) => void; hourHeight: number; onOpen: (id: string) => void;
}) {
  const { theme, clients } = useApp();
  const now = new Date();
  const totalH = (HOURS.length - 1) * hourHeight;

  return (
    <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: theme.line }}>
      {/* Day headers */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: theme.line }}>
        <View style={{ width: 54 }} />
        {weekDays.map((d) => {
          const isToday = isSameDay(d, now);
          const isSel = isSameDay(d, selectedDate);
          const has = weekAppts.some((a) => isSameDay(new Date(a.start), d));
          return (
            <Pressable key={d.toISOString()} onPress={() => onSelectDay(d)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ fontSize: 11, letterSpacing: 1, color: isSel ? theme.accent : theme.ink3, fontWeight: '500' }}>{DAY_SHORT[d.getDay()]}</Text>
              <View style={{ width: 34, height: 34, borderRadius: 17, marginTop: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: isToday ? theme.accent : isSel ? theme.accent + '22' : 'transparent' }}>
                <Text style={{ fontSize: 17, fontWeight: '500', fontStyle: 'italic', color: isToday ? '#fff' : theme.ink }}>{d.getDate()}</Text>
              </View>
              {has && !isToday && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.accent, marginTop: 3 }} />}
            </Pressable>
          );
        })}
      </View>
      {/* Time grid */}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', height: totalH + hourHeight }}>
          {/* Hour labels */}
          <View style={{ width: 54 }}>
            {HOURS.map((h) => (
              <Text key={h} style={{ height: hourHeight, fontSize: 11, color: theme.ink3, textAlign: 'right', paddingRight: 8, paddingTop: 2 }}>{hourLabel(h)}</Text>
            ))}
          </View>
          {/* Day columns */}
          {weekDays.map((d) => {
            const isToday = isSameDay(d, now);
            const appts = weekAppts.filter((a) => isSameDay(new Date(a.start), d));
            return (
              <View key={d.toISOString()} style={{ flex: 1, borderLeftWidth: 0.5, borderLeftColor: theme.line, backgroundColor: isToday ? theme.accent + '0A' : 'transparent' }}>
                {HOURS.map((h, i) => <View key={h} style={{ height: hourHeight, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: theme.line }} />)}
                {appts.map((a) => {
                  const s = new Date(a.start); const e = new Date(a.end);
                  const top = ((s.getHours() - HOUR_START) + s.getMinutes() / 60) * hourHeight;
                  const h = Math.max(((e.getTime() - s.getTime()) / 3600000) * hourHeight - 3, 24);
                  const client = clients.find((c) => c.id === a.clientId);
                  return (
                    <Pressable key={a.id} onPress={() => onOpen(a.id)} style={{ position: 'absolute', top, left: 3, right: 3, height: h, backgroundColor: theme.accent + '22', borderLeftWidth: 3, borderLeftColor: theme.accent, borderRadius: 8, padding: 6, overflow: 'hidden' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: theme.ink }} numberOfLines={1}>{client?.name ?? a.service}</Text>
                      <Text style={{ fontSize: 11, color: theme.ink2 }} numberOfLines={1}>{a.service}</Text>
                    </Pressable>
                  );
                })}
                {isToday && now.getHours() >= HOUR_START && now.getHours() <= HOUR_END && (
                  <View style={{ position: 'absolute', left: 0, right: 0, top: ((now.getHours() - HOUR_START) + now.getMinutes() / 60) * hourHeight, height: 1.5, backgroundColor: theme.accent }} />
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function DayGrid({ date, appts, hourHeight, onOpen }: { date: Date; appts: Appointment[]; hourHeight: number; onOpen: (id: string) => void }) {
  const { theme, clients } = useApp();
  const now = new Date();
  const isToday = isSameDay(date, now);
  return (
    <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: theme.line }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12 }}>
        <View style={{ position: 'relative' }}>
          {HOURS.map((h, i) => (
            <View key={h} style={{ height: hourHeight, flexDirection: 'row' }}>
              <Text style={{ width: 54, fontSize: 11, color: theme.ink3, paddingTop: 2 }}>{hourLabel(h)}</Text>
              <View style={{ flex: 1, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: theme.line, marginTop: 8 }} />
            </View>
          ))}
          <View style={StyleSheet.absoluteFill}>
            {appts.map((a) => {
              const s = new Date(a.start); const e = new Date(a.end);
              const top = ((s.getHours() - HOUR_START) + s.getMinutes() / 60) * hourHeight;
              const h = Math.max(((e.getTime() - s.getTime()) / 3600000) * hourHeight - 4, 40);
              const client = clients.find((c) => c.id === a.clientId);
              return (
                <Pressable key={a.id} onPress={() => onOpen(a.id)} style={{ position: 'absolute', top, left: 60, right: 0, height: h, backgroundColor: theme.accent + '22', borderLeftWidth: 3, borderLeftColor: theme.accent, borderRadius: 8, padding: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.ink }} numberOfLines={1}>{client?.name ?? a.service}</Text>
                  <Text style={{ fontSize: 12, color: theme.ink2 }} numberOfLines={1}>{a.service} · {fmt.timeShort(a.start)}</Text>
                </Pressable>
              );
            })}
            {isToday && now.getHours() >= HOUR_START && now.getHours() <= HOUR_END && (
              <View style={{ position: 'absolute', left: 60, right: 0, top: ((now.getHours() - HOUR_START) + now.getMinutes() / 60) * hourHeight + 8, height: 2, backgroundColor: theme.accent }} />
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function MonthGrid({ selectedDate, onSelect, appts }: { selectedDate: Date; onSelect: (d: Date) => void; appts: Appointment[] }) {
  const { theme } = useApp();
  const year = selectedDate.getFullYear(); const month = selectedDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysIn }, (_, i) => i < firstDay ? null : new Date(year, month, i - firstDay + 1));
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <View style={{ flex: 1, padding: 24, borderRightWidth: 0.5, borderRightColor: theme.line }}>
      <View style={{ flexDirection: 'row' }}>
        {DAY_SHORT.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: theme.ink3, paddingBottom: 8 }}>{d}</Text>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', flex: 1 }}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={{ width: `${100 / 7}%` }} />;
          const isToday = isSameDay(d, new Date());
          const isSel = isSameDay(d, selectedDate);
          const has = appts.some((a) => isSameDay(new Date(a.start), d));
          return (
            <Pressable key={d.toISOString()} onPress={() => onSelect(d)} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 8 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? theme.accent : 'transparent', borderWidth: isToday && !isSel ? 1.5 : 0, borderColor: theme.accent }}>
                <Text style={{ fontSize: 15, color: isSel ? '#fff' : isToday ? theme.accent : theme.ink, fontWeight: isToday || isSel ? '700' : '400' }}>{d.getDate()}</Text>
              </View>
              {has && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSel ? '#fff' : theme.accent, marginTop: 3 }} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MiniMonth({ selectedDate, onSelect, appts }: { selectedDate: Date; onSelect: (d: Date) => void; appts: Appointment[] }) {
  const { theme } = useApp();
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const year = viewMonth.getFullYear(); const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let i = 1; i <= daysIn; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);
  const shift = (n: number) => setViewMonth(new Date(year, month + n, 1));
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Eyebrow style={{ flex: 1 }}>{viewMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}</Eyebrow>
        <Pressable onPress={() => shift(-1)} hitSlop={8}><Icons.chevronLeft size={16} color={theme.ink3} /></Pressable>
        <Pressable onPress={() => shift(1)} hitSlop={8} style={{ marginLeft: 6 }}><Icons.chevronRight size={16} color={theme.ink3} /></Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {DAY_SHORT.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: theme.ink3 }}>{d}</Text>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
        {cells.map((n, i) => {
          if (!n) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
          const d = new Date(year, month, n);
          const isToday = isSameDay(d, new Date());
          const isSel = isSameDay(d, selectedDate);
          const has = appts.some((a) => isSameDay(new Date(a.start), d));
          return (
            <Pressable key={n} onPress={() => onSelect(d)} style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? theme.accent : 'transparent', borderWidth: isToday && !isSel ? 1.5 : 0, borderColor: theme.accent }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: isSel ? '#fff' : isToday ? theme.accent : theme.ink }}>{n}</Text>
              </View>
              {has && <View style={{ position: 'absolute', bottom: 2, width: 3, height: 3, borderRadius: 2, backgroundColor: isSel ? '#fff' : theme.accent }} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RailAppt({ appt, onPress }: { appt: Appointment; onPress: () => void }) {
  const { theme, clients } = useApp();
  const client = clients.find((c) => c.id === appt.clientId);
  const mins = Math.round((new Date(appt.end).getTime() - new Date(appt.start).getTime()) / 60000);
  return (
    <Pressable onPress={onPress} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }]}>
      {client && <Avatar name={client.name} tone={client.tone} size={34} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '600', fontSize: 14, color: theme.ink }} numberOfLines={1}>{client?.name}</Text>
        <Text style={{ color: theme.ink2, fontSize: 12 }} numberOfLines={1}>{appt.service}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontWeight: '600', fontSize: 13, color: theme.ink }}>{fmt.timeShort(appt.start)}</Text>
        <Text style={{ color: theme.ink3, fontSize: 11 }}>{fmt.duration(mins)}</Text>
      </View>
    </Pressable>
  );
}

function PeriodSummary({ label, appts, openHours }: { label: string; appts: Appointment[]; openHours: number }) {
  const { theme } = useApp();
  const booked = appts.filter((a) => a.status === 'upcoming' || a.status === 'completed');
  const revenue = booked.reduce((s, a) => s + a.price, 0);
  const bookedHours = booked.reduce((s, a) => s + (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000, 0);
  const pct = openHours > 0 ? Math.min(100, Math.round((bookedHours / openHours) * 100)) : 0;
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <Eyebrow>{label.toUpperCase()}</Eyebrow>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 26, fontWeight: '500', fontStyle: 'italic', color: theme.ink }}>{booked.length}</Text>
          <Text style={{ color: theme.ink3, fontSize: 11, marginTop: 2 }}>appointment{booked.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 26, fontWeight: '500', fontStyle: 'italic', color: theme.ink }}>{fmt.currency(revenue)}</Text>
          <Text style={{ color: theme.ink3, fontSize: 11, marginTop: 2 }}>revenue</Text>
        </View>
      </View>
      {openHours > 0 && (
        <>
          <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 14 }}>{Math.max(0, Math.round(openHours - bookedHours))} of {Math.round(openHours)} open hours unbooked</Text>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.bg2, marginTop: 8, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 4, backgroundColor: theme.accent }} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 18, paddingBottom: 14 },
  toggle: { flexDirection: 'row', borderRadius: 999, padding: 4 },
  toggleBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
  rail: { height: '100%' },
  card: { borderRadius: 16, borderWidth: 0.5, padding: 16 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
