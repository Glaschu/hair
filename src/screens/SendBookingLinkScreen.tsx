import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Share, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Card, Icons, RoundBtn, useLocalDialog } from '../components';
import { fmt, addDays, generateTimeSlots, isSameDay } from '../data/utils';
import { hasConflict } from '../data/booking';
import { loadCredentials } from '../data/bookingStore';
import { createLink } from '../data/bookingApi';
import { newClientRef, recordSentLink } from '../db/bookingLinks';
import { bookingInviteMessage, firstNameOf } from '../data/bookingMessage';
import { Service } from '../data/types';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SendBookingLink'>;

/** How many days ahead she can offer from. */
const DAYS_AHEAD = 28;

export default function SendBookingLinkScreen() {
  const { theme, clients, services, appointments, schedule, studioName, backend } = useApp();
  const { alert, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const client = clients.find((c) => c.id === route.params.clientId);
  const [service, setService] = useState<Service | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);   // ISO starts
  const [sending, setSending] = useState(false);

  const busy = useMemo(
    () => appointments
      .filter((a) => a.status === 'upcoming')
      .map((a) => ({ start: new Date(a.start), end: new Date(a.end) })),
    [appointments],
  );

  /** Free times over the next few weeks, her working hours only. */
  const days = useMemo(() => {
    if (!service) return [];
    const out: { date: Date; times: Date[] }[] = [];
    for (let i = 1; i <= DAYS_AHEAD; i++) {
      const date = addDays(new Date(), i);
      const open = schedule[date.getDay()]?.open ?? true;
      if (!open) continue;

      const times = generateTimeSlots(schedule, date)
        .map(({ h, m }) => {
          const start = new Date(date);
          start.setHours(h, m, 0, 0);
          return start;
        })
        .filter((start) => {
          const end = new Date(start.getTime() + service.duration * 60000);
          return !hasConflict(start, end, busy);
        });

      if (times.length) out.push({ date, times });
    }
    return out;
  }, [service, schedule, busy]);

  const toggle = (start: Date) => {
    const iso = start.toISOString();
    setChosen((prev) => prev.includes(iso) ? prev.filter((t) => t !== iso) : [...prev, iso]);
  };

  const send = async () => {
    if (!client || !service || !chosen.length) return;
    setSending(true);
    try {
      const creds = await loadCredentials();
      if (!creds) {
        // A backstop now rather than the first she hears of it: the client card
        // checks before letting her in. Worded from the same place, so the two
        // can never say different things.
        await alert({ title: 'Not set up yet', message: backend.why('booking-links').why });
        return;
      }

      // A fresh reference each time, so the service can never tell that
      // two links belong to the same person.
      const clientRef = newClientRef();
      const slots = chosen.sort().map((iso) => ({
        startsAt: iso,
        endsAt: new Date(new Date(iso).getTime() + service.duration * 60000).toISOString(),
      }));

      const link = await createLink(creds, {
        clientRef,
        greeting: firstNameOf(client.name),
        serviceName: service.name,
        durationMins: service.duration,
        // Pence on the wire: a 50% deposit on a float is a rounding argument.
        priceMinor: Math.round(service.price * 100),
        slots,
      });

      recordSentLink({
        token: link.token, clientRef, clientId: client.id,
        serviceName: service.name, url: link.url,
        createdAt: Date.now(), expiresAt: link.expiresAt,
      });

      await Share.share({
        message: bookingInviteMessage({
          firstName: firstNameOf(client.name),
          studioName,
          service,
          slotCount: slots.length,
          url: link.url,
          depositPercent: 50,
        }),
      });
      nav.goBack();
    } catch (e) {
      await alert({
        title: "Couldn't make the link",
        message: e instanceof Error ? e.message : 'Try again in a moment.',
      });
    } finally {
      setSending(false);
    }
  };

  if (!client) return null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.header}>
        <RoundBtn label="Back" onPress={() => nav.goBack()} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: theme.ink3 }]}>SEND A LINK</Text>
          <Text style={[styles.title, { color: theme.ink }]} numberOfLines={1}>{client.name}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 22 }}>
        <View style={{ gap: 10 }}>
          <Text style={[styles.label, { color: theme.ink3 }]}>WHAT ARE THEY BOOKING?</Text>
          <View style={{ gap: 8 }}>
            {services.map((s) => {
              const active = service?.id === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => { setService(s); setChosen([]); }}
                  style={[styles.pick, {
                    backgroundColor: theme.card,
                    borderColor: active ? theme.accent : theme.line,
                    borderWidth: active ? 1.5 : 0.5,
                  }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickName, { color: theme.ink }]}>{s.name}</Text>
                    <Text style={[styles.pickSub, { color: theme.ink2 }]}>
                      {fmt.duration(s.duration)} · {fmt.currency(s.price)}
                    </Text>
                  </View>
                  {active && <Icons.check size={17} color={theme.accent} strokeWidth={2.2} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {service && (
          <View style={{ gap: 12 }}>
            <Text style={[styles.label, { color: theme.ink3 }]}>
              WHICH TIMES WILL YOU OFFER? {chosen.length > 0 && `· ${chosen.length} CHOSEN`}
            </Text>
            <Text style={{ fontSize: 13.5, lineHeight: 19, color: theme.ink2 }}>
              Pick a few. They take one, and the rest go back to you — nothing is held
              in your diary until they book.
            </Text>

            {days.length === 0 ? (
              <Card style={{ padding: 18 }}>
                <Text style={{ fontSize: 14, color: theme.ink2, lineHeight: 20 }}>
                  Nothing free for a {fmt.duration(service.duration)} appointment in the next
                  four weeks. Your book is full.
                </Text>
              </Card>
            ) : days.map(({ date, times }) => (
              <View key={date.toISOString()} style={{ gap: 8 }}>
                <Text style={[styles.day, { color: theme.ink }]}>
                  {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                </Text>
                <View style={styles.timeGrid}>
                  {times.map((t) => {
                    const iso = t.toISOString();
                    const active = chosen.includes(iso);
                    return (
                      <Pressable
                        key={iso}
                        onPress={() => toggle(t)}
                        style={[styles.time, {
                          backgroundColor: active ? theme.accent : theme.card,
                          borderColor: active ? theme.accent : theme.line,
                        }]}
                      >
                        <Text style={[styles.timeText, { color: active ? '#fff' : theme.ink }]}>
                          {fmt.timeShort(iso)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {service && chosen.length > 0 && (
        <View style={[styles.footer, { backgroundColor: theme.bg, borderTopColor: theme.line }]}>
          <Pressable
            onPress={send}
            disabled={sending}
            style={[styles.send, { backgroundColor: sending ? theme.bg2 : theme.accent }]}
          >
            {sending
              ? <ActivityIndicator color={theme.ink2} />
              : (
                <>
                  <Icons.message size={17} color="#fff" />
                  <Text style={styles.sendText}>
                    Send {chosen.length} time{chosen.length === 1 ? '' : 's'} to {firstNameOf(client.name)}
                  </Text>
                </>
              )}
          </Pressable>
        </View>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  title: { fontSize: 24, fontFamily: SERIF, marginTop: 2 },
  label: { fontSize: 10, letterSpacing: 1.2, fontWeight: '600' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  pickName: { fontSize: 15, fontWeight: '600' },
  pickSub: { fontSize: 13, marginTop: 2 },
  day: { fontSize: 18, fontFamily: SERIF },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  time: { minWidth: 78, minHeight: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  timeText: { fontSize: 14.5, fontWeight: '500' },
  footer: { padding: 16, paddingBottom: 28, borderTopWidth: 0.5 },
  send: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 54, borderRadius: 14 },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
