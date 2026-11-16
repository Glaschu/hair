import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { useDialog } from '../data/DialogContext';
import {
  dateKey, dayOffOn, openDay, describeDayOff, appointmentsOnDaysOff, closedOn, newDayOffId as newId,
} from '../data/daysOff';
import { fmt } from '../data/utils';


/**
 * The top of a day on the calendar: whether she has blocked it off, and the
 * one-tap way to change that — so a day off can be made where she is already
 * looking at the day, not only in Settings.
 *
 * Opening one day of a longer break splits it, keeping the days either side
 * blocked. Blocking a day with appointments on it shows them; it never cancels
 * them.
 */
export function DayOffBanner({ date, style }: { date: Date; style?: object }) {
  const { theme, daysOff, setDaysOff, appointments, clients, schedule } = useApp();
  const dialog = useDialog();
  const off = dayOffOn(daysOff, date);
  const key = dateKey(date);
  const past = key < dateKey(new Date());
  if (past && !off) return null;
  // A day she never works anyway (her weekly hours say closed) has nothing to block.
  if (!off && closedOn(schedule, [], date).closed) return null;

  const label = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  if (off) {
    const partOfLonger = off.start !== off.end;
    return (
      <View style={[styles.offCard, { backgroundColor: theme.ink3 + '14', borderColor: theme.line }, style]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.ink }}>
            Day off{off.note ? ` · ${off.note}` : ''}
          </Text>
          <Text style={{ fontSize: 12, color: theme.ink3, marginTop: 2 }}>
            {partOfLonger ? `Part of ${describeDayOff(off)}. ` : ''}Not offered in booking links.
          </Text>
        </View>
        {!past && (
          <Pressable
            hitSlop={8}
            onPress={async () => {
              const ok = await dialog.confirm({
                title: `Open ${label} again?`,
                message: partOfLonger
                  ? `Just this day — the rest of ${describeDayOff(off)} stays blocked off.`
                  : 'It can be offered in links again, and times already in links you sent come back.',
                confirmLabel: 'Open this day',
              });
              if (ok) setDaysOff((prev) => openDay(prev, date, newId));
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent }}>Open this day</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <Pressable
      onPress={async () => {
        const ok = await dialog.confirm({
          title: `Block off ${label}?`,
          message: "It won't be offered in booking links, and clients can't book it from links you've already sent.",
          confirmLabel: 'Block off',
        });
        if (!ok) return;
        const entry = { id: newId(), start: key, end: key };
        setDaysOff((prev) => [...prev, entry]);
        const booked = appointmentsOnDaysOff(appointments, [entry]);
        if (booked.length) {
          await dialog.alert({
            title: `${booked.length} appointment${booked.length > 1 ? 's are' : ' is'} still booked`,
            message: `${booked.map((a) =>
              `• ${clients.find((c) => c.id === a.clientId)?.name ?? 'A client'}, ${fmt.time(a.start)}`).join('\n')}\n\nThey haven't been changed. Open each one to move or cancel it.`,
          });
        }
      }}
      style={({ pressed }) => [styles.blockRow, { opacity: pressed ? 0.6 : 1 }, style]}
      accessibilityRole="button"
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.ink3 }}>Block off this day</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  offCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  blockRow: { alignSelf: 'flex-end', paddingVertical: 4 },
});
