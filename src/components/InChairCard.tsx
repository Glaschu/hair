import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { chairOccupant, clientVisitContext } from '../data/visits';
import { fmt } from '../data/utils';
import { Avatar } from './Avatar';
import { Icons } from './Icons';
import { PhotoStrip } from './PhotoStrip';
import { SERIF, typography } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Chair-side card for the phone Today screen: who's in the chair (or up
 * next), their allergies, working formula, the plan recorded last visit,
 * and a strip of their photos. Renders nothing on an empty afternoon.
 */
export function InChairCard() {
  const { theme, appointments, clients } = useApp();
  const nav = useNavigation<Nav>();

  // Re-evaluate the countdown / occupant once a minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { current, hero } = chairOccupant(appointments, now);
  const client = hero ? clients.find((c) => c.id === hero.clientId) : undefined;
  if (!hero || !client) return null;

  const inChair = current?.id === hero.id;
  const remainingMin = inChair
    ? Math.max(0, Math.round((new Date(hero.end).getTime() - now.getTime()) / 60000))
    : 0;
  const eyebrow = inChair
    ? `IN THE CHAIR · ${remainingMin} MIN LEFT`
    : `UP NEXT · ${fmt.timeShort(hero.start).toUpperCase()}`;

  const ctx = clientVisitContext(client.id, appointments, client);
  const hasAllergies = !!client.allergies && client.allergies !== 'None on file';
  const photos = (client.photos ?? []).slice(0, 8);

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
      <Pressable
        onPress={() => nav.navigate('AppointmentDetail', { appointmentId: hero.id })}
        style={({ pressed }) => [styles.card, {
          backgroundColor: theme.card,
          borderColor: theme.accent + '50',
          opacity: pressed ? 0.92 : 1,
        }]}
      >
        <Text style={[styles.eyebrow, { color: theme.accent }]}>{eyebrow}</Text>

        <View style={styles.headRow}>
          <Avatar name={client.name} tone={client.tone} photo={client.photo} size={46} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.name, { color: theme.ink }]} numberOfLines={1}>{client.name}</Text>
            <Text style={[styles.service, { color: theme.ink2 }]} numberOfLines={1}>
              {hero.service}{inChair ? ` · until ${fmt.timeShort(hero.end)}` : ''}
              {ctx.lastCompleted ? ` · last visit ${fmt.ago(ctx.lastCompleted.start)}` : ' · first visit'}
            </Text>
          </View>
          <Icons.chevronRight size={16} color={theme.ink3} />
        </View>

        {hasAllergies && (
          <View style={[styles.allergyStrip, { backgroundColor: theme.warn + '18' }]}>
            <Icons.alert size={13} color={theme.warn} />
            <Text style={[styles.allergyText, { color: theme.ink }]} numberOfLines={2}>{client.allergies}</Text>
          </View>
        )}

        {!!ctx.effectiveFormula && (
          <View style={styles.block}>
            <Text style={[styles.blockLabel, { color: theme.ink3 }]}>
              FORMULA{ctx.lastCompleted?.formula ? ` · ${fmt.day(ctx.lastCompleted.start).toUpperCase()}` : ' · CLIENT CARD'}
            </Text>
            <Text style={[typography.mono(13), { color: theme.ink, lineHeight: 19 }]} numberOfLines={2}>
              {ctx.effectiveFormula}
            </Text>
          </View>
        )}

        {ctx.nextPlan && (
          <View style={[styles.planBlock, { backgroundColor: theme.accent + '10', borderColor: theme.accent + '30' }]}>
            <Text style={[styles.blockLabel, { color: theme.accent }]}>
              PLAN FROM LAST VISIT · {fmt.day(ctx.nextPlan.date).toUpperCase()}
            </Text>
            <Text style={[styles.planText, { color: theme.ink }]} numberOfLines={3}>{ctx.nextPlan.text}</Text>
          </View>
        )}

        {photos.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <PhotoStrip photos={photos} size={56} horizontal />
          </View>
        )}

        <View style={styles.footRow}>
          <Pressable
            onPress={() => nav.navigate('ClientDetail', { clientId: client.id })}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
            <Icons.users size={13} color={theme.accent} />
            <Text style={[styles.footLink, { color: theme.accent }]}>Client profile</Text>
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 16 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 22, fontFamily: SERIF, lineHeight: 26 },
  service: { fontSize: 12.5, marginTop: 1 },
  allergyStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 12,
  },
  allergyText: { fontSize: 12.5, fontWeight: '600', flex: 1 },
  block: { marginTop: 12 },
  blockLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  planBlock: { borderRadius: 12, borderWidth: 1, padding: 10, marginTop: 12 },
  planText: { fontSize: 13, lineHeight: 18 },
  footRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  footLink: { fontSize: 13, fontWeight: '600' },
});
