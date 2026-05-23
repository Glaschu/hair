import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn, CustomTimeRow } from '../components';
import { fmt, isSameDay, addDays, checkSchedule, fmtHHMM, DAY_NAMES, generateTimeSlots } from '../data/utils';
import { hasConflict } from '../data/booking';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'RescheduleModal'>;

export default function RescheduleModal() {
  const { theme, appointments, setAppointments, services, schedule, bookingWindowDays } = useApp();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const appt = appointments.find((a) => a.id === route.params.appointmentId);
  if (!appt) return null;

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState<{ h: number; m: number } | null>(null);
  const [showCustomTime, setShowCustomTime] = useState(false);

  const svc = services.find((s) => s.name === appt.service);
  const durationMins = svc?.duration ?? 60;

  const timeSlots = useMemo(
    () => generateTimeSlots(schedule, selectedDate),
    [schedule, selectedDate],
  );

  const takenSlots = useMemo(() => {
    return appointments
      .filter((a) =>
        isSameDay(new Date(a.start), selectedDate) &&
        a.status !== 'cancelled' &&
        a.id !== appt.id
      )
      .map((a) => ({ start: new Date(a.start), end: new Date(a.end) }));
  }, [appointments, selectedDate, appt.id]);

  const isSlotTaken = (h: number, m: number) => {
    const start = new Date(selectedDate);
    start.setHours(h, m, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + durationMins);
    return hasConflict(start, end, takenSlots);
  };

  const scheduleCheck = useMemo(() => {
    if (!selectedTime) return null;
    const d = new Date(selectedDate);
    d.setHours(selectedTime.h, selectedTime.m, 0, 0);
    return checkSchedule(schedule, d, durationMins);
  }, [schedule, selectedDate, selectedTime, durationMins]);

  const canSave = selectedTime !== null;

  const handleSave = () => {
    if (!selectedTime) return;
    const newStart = new Date(selectedDate);
    newStart.setHours(selectedTime.h, selectedTime.m, 0, 0);
    const newEnd = new Date(newStart);
    newEnd.setMinutes(newEnd.getMinutes() + durationMins);
    setAppointments((prev) => prev.map((a) =>
      a.id === appt.id
        ? { ...a, start: newStart.toISOString(), end: newEnd.toISOString() }
        : a
    ));
    nav.goBack();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <RoundBtn onPress={() => nav.goBack()} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>Reschedule</Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.saveBtn, { backgroundColor: canSave ? theme.accent : theme.bg2 }]}
        >
          <Text style={[styles.saveBtnText, { color: canSave ? '#fff' : theme.ink3 }]}>Save</Text>
        </Pressable>
      </View>

      {/* Current appointment summary */}
      <View style={[styles.summaryStrip, { backgroundColor: theme.bg2 }]}>
        <Text style={[styles.summaryText, { color: theme.ink2 }]}>
          {appt.service} · currently {fmt.rel(appt.start)} at {fmt.timeShort(appt.start)}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>PICK A DATE</Text>

        {/* Date strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Array.from({ length: bookingWindowDays }, (_, i) => addDays(new Date(), i)).map((day, i, arr) => {
              const isSelected = isSameDay(day, selectedDate);
              const showMonth = i === 0 || day.getMonth() !== arr[i - 1].getMonth();
              return (
                <React.Fragment key={day.toISOString()}>
                  {showMonth && (
                    <View style={styles.monthDivider}>
                      <Text style={[styles.monthDividerText, { color: theme.ink3 }]}>
                        {day.toLocaleDateString('en-GB', { month: 'long' })}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    onPress={() => { setSelectedDate(day); setSelectedTime(null); }}
                    style={[styles.datePill, { backgroundColor: isSelected ? theme.accent : theme.bg2 }]}
                  >
                    <Text style={[styles.datePillDay, { color: isSelected ? '#fff' : theme.ink3 }]}>
                      {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </Text>
                    <Text style={[styles.datePillNum, { color: isSelected ? '#fff' : theme.ink }]}>
                      {day.getDate()}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        </ScrollView>

        <Text style={[styles.sectionLabel, { color: theme.ink3, marginBottom: 12 }]}>PICK A TIME</Text>

        {/* Time grid */}
        <View style={styles.timeGrid}>
          {timeSlots.map(({ h, m }) => {
            const taken = isSlotTaken(h, m);
            const sel = selectedTime?.h === h && selectedTime?.m === m;
            const label = `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
            return (
              <Pressable
                key={`${h}${m}`}
                onPress={() => !taken && setSelectedTime({ h, m })}
                disabled={taken}
                style={[styles.timeSlot, {
                  backgroundColor: taken ? theme.bg2 : sel ? theme.accent : theme.card,
                  borderColor: sel ? theme.accent : taken ? 'transparent' : theme.line,
                  opacity: taken ? 0.4 : 1,
                }]}
              >
                <Text style={[styles.timeSlotText, { color: sel ? '#fff' : taken ? theme.ink3 : theme.ink }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={() => setShowCustomTime((v) => !v)} style={styles.customToggle}>
          <Text style={[styles.customToggleText, { color: theme.accent }]}>
            {showCustomTime ? '− Hide custom time' : '+ Custom time'}
          </Text>
        </Pressable>
        {showCustomTime && (
          <CustomTimeRow value={selectedTime ?? { h: 9, m: 0 }} onChange={setSelectedTime} />
        )}

        {scheduleCheck && (scheduleCheck.dayClosed || scheduleCheck.offHours) && (
          <View style={[styles.schedWarn, { backgroundColor: theme.warn + '18', borderColor: theme.warn }]}>
            <Icons.alert size={14} color={theme.warn} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.schedWarnTitle, { color: theme.ink }]}>
                {scheduleCheck.dayClosed ? 'Booking on a day off' : 'Outside working hours'}
              </Text>
              <Text style={[styles.schedWarnSub, { color: theme.ink2 }]}>
                {scheduleCheck.dayClosed
                  ? `${DAY_NAMES[selectedDate.getDay()]} is marked as closed.`
                  : scheduleCheck.day
                    ? `${DAY_NAMES[selectedDate.getDay()]} runs ${fmtHHMM(scheduleCheck.day.start)}–${fmtHHMM(scheduleCheck.day.end)}`
                    : ''}
              </Text>
            </View>
          </View>
        )}

        {timeSlots.length === 0 && (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={[{ color: theme.ink3, fontSize: 14, fontStyle: 'italic' }]}>
              No available slots for this date
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: '500', fontStyle: 'italic' },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { fontSize: 15, fontWeight: '600' },
  summaryStrip: {
    marginHorizontal: 20,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
  },
  summaryText: { fontSize: 13 },
  sectionLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500', marginBottom: 14 },
  monthDivider: { justifyContent: 'flex-end', paddingBottom: 10, paddingHorizontal: 4 },
  monthDividerText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  datePill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  datePillDay: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  datePillNum: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeSlot: { width: '22%', paddingVertical: 10, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  timeSlotText: { fontSize: 13, fontWeight: '500' },
  customToggle: { paddingVertical: 6, alignSelf: 'flex-start', marginTop: 4 },
  customToggleText: { fontSize: 13, fontWeight: '600' },
  schedWarn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 0.5, marginTop: 16,
  },
  schedWarnTitle: { fontSize: 12, fontWeight: '600' },
  schedWarnSub: { fontSize: 11, marginTop: 2, lineHeight: 16 },
});
