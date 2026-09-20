import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { chairOccupant, clientVisitContext } from '../data/visits';
import { fmt } from '../data/utils';
import { Avatar, Icons, PhotoStrip } from '../components';
import { Eyebrow, Btn } from './ui';
import { SERIF, typography } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Chair-side client panel for the iPad Today screen: the stylist-facing
 * companion while someone is in the chair — allergies, working formula,
 * hair profile, the plan recorded last visit, recent history, and photos.
 * Renders nothing when the day has no current or upcoming appointment.
 * (Never mount this in Room mode — that surface is client-safe.)
 */
export function ChairClientPanel() {
  const { theme, appointments, clients } = useApp();
  const nav = useNavigation<Nav>();

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

  const ctx = clientVisitContext(client.id, appointments, client);
  const hasAllergies = !!client.allergies && client.allergies !== 'None on file';
  const photos = (client.photos ?? []).slice(0, 10);
  const hairLine = [client.hair.type, client.hair.length, client.hair.natural].filter(Boolean).join(' · ');

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.accent + '45' }]}>
      <Eyebrow color={theme.accent}>
        {inChair ? `IN THE CHAIR · ${remainingMin} MIN LEFT` : `UP NEXT · ${fmt.timeShort(hero.start).toUpperCase()}`}
      </Eyebrow>

      <View style={styles.headRow}>
        <Avatar name={client.name} tone={client.tone} photo={client.photo} size={54} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.name, { color: theme.ink }]} numberOfLines={1}>{client.name}</Text>
          <Text style={{ fontSize: 13, color: theme.ink2 }} numberOfLines={1}>
            {hero.service}
            {ctx.lastCompleted ? ` · last visit ${fmt.ago(ctx.lastCompleted.start)}` : ' · first visit'}
          </Text>
        </View>
      </View>

      {hasAllergies && (
        <View style={[styles.allergyStrip, { backgroundColor: theme.warn + '18' }]}>
          <Icons.alert size={14} color={theme.warn} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.ink, flex: 1 }} numberOfLines={2}>
            {client.allergies}
          </Text>
        </View>
      )}

      {!!ctx.effectiveFormula && (
        <View style={[styles.formulaBox, { backgroundColor: theme.bg2 }]}>
          <Text style={[styles.blockLabel, { color: theme.ink3 }]}>
            FORMULA{ctx.lastCompleted?.formula ? ` · ${fmt.day(ctx.lastCompleted.start).toUpperCase()}` : ' · CLIENT CARD'}
          </Text>
          <Text style={[typography.mono(13), { color: theme.ink, lineHeight: 20 }]}>{ctx.effectiveFormula}</Text>
        </View>
      )}

      {ctx.nextPlan && (
        <View style={[styles.planBox, { backgroundColor: theme.accent + '10', borderColor: theme.accent + '30' }]}>
          <Text style={[styles.blockLabel, { color: theme.accent }]}>
            PLAN FROM LAST VISIT · {fmt.day(ctx.nextPlan.date).toUpperCase()}
          </Text>
          <Text style={{ fontSize: 13.5, lineHeight: 19, color: theme.ink }}>{ctx.nextPlan.text}</Text>
        </View>
      )}

      {!!hairLine && (
        <View style={styles.metaRow}>
          <Text style={[styles.blockLabel, { color: theme.ink3, marginBottom: 0, width: 46 }]}>HAIR</Text>
          <Text style={{ fontSize: 13, color: theme.ink2, flex: 1 }} numberOfLines={1}>{hairLine}</Text>
        </View>
      )}
      {!!client.notes && (
        <View style={styles.metaRow}>
          <Text style={[styles.blockLabel, { color: theme.ink3, marginBottom: 0, width: 46 }]}>NOTES</Text>
          <Text style={{ fontSize: 13, color: theme.ink2, flex: 1 }} numberOfLines={3}>{client.notes}</Text>
        </View>
      )}

      {ctx.recentCompleted.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Text style={[styles.blockLabel, { color: theme.ink3 }]}>PREVIOUS VISITS</Text>
          <View style={{ gap: 6 }}>
            {ctx.recentCompleted.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })}
                style={({ pressed }) => [styles.visitRow, { backgroundColor: pressed ? theme.bg2 : 'transparent', borderColor: theme.line }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.ink }} numberOfLines={1}>
                    {a.service} <Text style={{ fontWeight: '400', color: theme.ink3 }}>· {fmt.ago(a.start)}</Text>
                  </Text>
                  {!!(a.formula || a.notes) && (
                    <Text style={{ fontSize: 12, color: theme.ink3, marginTop: 1 }} numberOfLines={1}>
                      {a.formula || a.notes}
                    </Text>
                  )}
                </View>
                <Icons.chevronRight size={14} color={theme.ink3} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {photos.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Text style={[styles.blockLabel, { color: theme.ink3 }]}>PHOTOS</Text>
          <PhotoStrip photos={photos} size={64} horizontal />
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <Btn variant="soft" icon={<Icons.users size={14} color={theme.ink2} />}
          onPress={() => nav.navigate('ClientDetail', { clientId: client.id })}>
          Open client profile
        </Btn>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  name: { fontSize: 24, fontFamily: SERIF, lineHeight: 28 },
  allergyStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 12,
  },
  formulaBox: { borderRadius: 12, padding: 12, marginTop: 12 },
  planBox: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  blockLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  visitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
  },
});
