import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useApp } from '../../data/AppContext';
import { useResponsive } from '../../hooks/useResponsive';
import { useShell } from '../shellContext';
import { Avatar, Icons, RoundBtn } from '../../components';
import { fmt, addDays } from '../../data/utils';
import { Appointment, Client } from '../../data/types';
import { Eyebrow } from '../ui';
import { SERIF } from '../../theme';

/**
 * Room mode (variant D) — a client-safe screen Jessie can leave on the desk
 * facing the chair. No money, no nav: just who's in the chair, how long left,
 * what's coming up, and whether the day is on track.
 */
export function RoomMode() {
  const { theme, appointments, clients, studioName } = useApp();
  const { isLandscape } = useResponsive();
  const { setClientMode } = useShell();
  const now = new Date();

  const today0 = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const tomorrow0 = useMemo(() => addDays(today0, 1), [today0]);
  const todayAll = useMemo(() =>
    appointments
      .filter((a) => { const d = new Date(a.start); return d >= today0 && d < tomorrow0; })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, today0, tomorrow0]);

  const nowAppt = todayAll.find((a) =>
    a.status === 'upcoming' && new Date(a.start) <= now && new Date(a.end) > now);
  const nextAppt = nowAppt ?? todayAll.find((a) =>
    a.status === 'upcoming' && new Date(a.start) > now);
  const heroAppt: Appointment | undefined = nowAppt ?? nextAppt;
  const heroClient: Client | undefined = heroAppt ? clients.find((c) => c.id === heroAppt.clientId) : undefined;

  const afterHero = heroAppt ? new Date(heroAppt.end) : now;
  const laterToday = todayAll.filter((a) =>
    a.status === 'upcoming' && new Date(a.start) >= afterHero && a.id !== heroAppt?.id);

  const doneCount = todayAll.filter((a) => a.status === 'completed').length;
  const totalToday = todayAll.length;
  const onScheduleOk = !nowAppt || new Date(nowAppt.start) <= now;

  // Ring math for the in-progress appointment.
  let pct = 0;
  let remainingMin = 0;
  let endLabel = '';
  let started = '';
  if (nowAppt) {
    const start = new Date(nowAppt.start).getTime();
    const end = new Date(nowAppt.end).getTime();
    pct = Math.max(0, Math.min(100, ((now.getTime() - start) / (end - start)) * 100));
    remainingMin = Math.max(0, Math.round((end - now.getTime()) / 60000));
    endLabel = fmt.timeShort(new Date(end).toISOString());
    started = fmt.timeShort(nowAppt.start);
  }

  const chips = useMemo(() => buildChips(heroAppt, heroClient), [heroAppt, heroClient]);
  const nextFreeStart = heroAppt ? new Date(heroAppt.end) : null;
  const nextFreeEnd = laterToday[0] ? new Date(laterToday[0].start) : null;
  const freeMins = nextFreeStart && nextFreeEnd ? (nextFreeEnd.getTime() - nextFreeStart.getTime()) / 60000 : null;

  // Header — always rendered top of room mode.
  const header = (
    <View style={styles.topbar}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }} />
        <Text style={{ fontSize: 16, fontFamily: SERIF, color: theme.ink }}>{studioName.toLowerCase()}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <Text style={{ color: theme.ink2, fontSize: 13, fontWeight: '500' }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {fmt.timeShort(now.toISOString())}
      </Text>
      <View style={[styles.modePill, { backgroundColor: theme.bg2 }]}>
        <Icons.lock size={12} color={theme.ink2} />
        <Text style={{ color: theme.ink, fontSize: 12, fontWeight: '600', marginLeft: 6 }}>Room mode</Text>
        <Text style={{ color: theme.ink3, fontSize: 12, marginLeft: 6 }}>· amounts hidden</Text>
      </View>
      <RoundBtn size={38} onPress={() => setClientMode(false)}>
        <Icons.lock size={16} color={theme.ink} />
      </RoundBtn>
    </View>
  );

  // Welcome row.
  const welcome = (
    <View style={{ paddingHorizontal: 36, paddingTop: 16 }}>
      <Eyebrow>{nowAppt ? 'IN THE CHAIR NOW' : nextAppt ? 'STARTING SOON' : 'NO ONE IN THE CHAIR'}</Eyebrow>
      <Text style={[styles.welcome, { color: theme.ink }]}>
        {heroClient ? <>Welcome back, <Text style={{ color: theme.ink2 }}>{heroClient.name.split(' ')[0]}</Text>.</> : 'Quiet moment.'}
      </Text>
    </View>
  );

  const heroCard = heroAppt && heroClient ? (
    <View style={[styles.hero, { backgroundColor: theme.heroBg }]}>
      <View style={{ flex: 1.4, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Avatar name={heroClient.name} tone={heroClient.tone} photo={heroClient.photo} size={72} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroName}>{heroClient.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <View style={[styles.statusPill, { backgroundColor: nowAppt ? 'rgba(159,191,148,0.25)' : 'rgba(255,255,255,0.12)' }]}>
                <Text style={{ color: nowAppt ? '#A9C497' : 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
                  {nowAppt ? 'IN PROGRESS' : 'NEXT UP'}
                </Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                {nowAppt ? `started ${started}` : `at ${fmt.timeShort(heroAppt.start)}`}
              </Text>
            </View>
          </View>
        </View>
        <Text style={styles.heroService}>{heroAppt.service}</Text>
        <View style={styles.chipRow}>
          {chips.map((c) => (
            <View key={c} style={styles.heroChip}>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' }}>{c}</Text>
            </View>
          ))}
        </View>
      </View>
      {nowAppt && (
        <View style={{ alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ring pct={pct} accent={theme.accent} />
          <View style={styles.ringInner}>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, letterSpacing: 1.4, fontWeight: '600' }}>REMAINING</Text>
            <Text style={styles.ringValue}>{remainingMin} <Text style={{ fontFamily: SERIF, fontSize: 22 }}>min</Text></Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>ends {endLabel}</Text>
          </View>
        </View>
      )}
    </View>
  ) : (
    <View style={[styles.hero, { backgroundColor: theme.heroBg, justifyContent: 'center' }]}>
      <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: SERIF, fontSize: 20, lineHeight: 24, textAlign: 'center' }}>
        No one in the chair right now.
      </Text>
    </View>
  );

  const laterCol = (
    <View style={{ flex: 1.4, minWidth: 0, gap: 10 }}>
      <Eyebrow>LATER TODAY</Eyebrow>
      {laterToday.length === 0 ? (
        <View style={[styles.dashed, { borderColor: theme.line }]}>
          <Text style={{ color: theme.ink3, fontStyle: 'italic', fontSize: 14, textAlign: 'center' }}>
            That's the day — nothing else booked.
          </Text>
        </View>
      ) : (
        <>
          {laterToday.map((a, i) => {
            const prevEnd = i === 0 ? afterHero : new Date(laterToday[i - 1].end);
            const gapMins = (new Date(a.start).getTime() - prevEnd.getTime()) / 60000;
            const c = clients.find((x) => x.id === a.clientId);
            return (
              <View key={a.id}>
                {gapMins > 0 && (
                  <Text style={{ textAlign: 'center', color: theme.ink3, fontSize: 12, fontWeight: '500', paddingVertical: 6 }}>
                    {fmtGap(gapMins)} free
                  </Text>
                )}
                <View style={[styles.laterRow, { borderTopColor: theme.line }]}>
                  <Text style={{ width: 64, fontSize: 18, fontFamily: SERIF, color: theme.ink }}>
                    {fmt.timeShort(a.start).replace('am', '').replace('pm', '')}
                  </Text>
                  {c && <Avatar name={c.name} tone={c.tone} photo={c.photo} size={40} />}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }} numberOfLines={1}>{c?.name}</Text>
                    <Text style={{ fontSize: 13, color: theme.ink2 }} numberOfLines={1}>{a.service}</Text>
                  </View>
                </View>
              </View>
            );
          })}
          <View style={[styles.dashed, { borderColor: theme.line, marginTop: 8 }]}>
            <Text style={{ color: theme.ink3, fontStyle: 'italic', fontSize: 13, textAlign: 'center' }}>
              That's the day.
            </Text>
          </View>
        </>
      )}
    </View>
  );

  const glanceCol = (
    <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
      <Eyebrow>AT A GLANCE</Eyebrow>
      {/* On schedule */}
      <View style={[styles.glanceCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <View style={[styles.checkChip, { backgroundColor: onScheduleOk ? theme.sage + '30' : theme.warn + '30' }]}>
          <Icons.check size={18} color={onScheduleOk ? theme.sage : theme.warn} strokeWidth={2.5} />
        </View>
        <View>
          <Text style={{ fontWeight: '600', fontSize: 16, color: theme.ink }}>{onScheduleOk ? 'On schedule' : 'Running over'}</Text>
          <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 2 }}>
            {onScheduleOk ? 'Running right on time' : 'Past the booked end time'}
          </Text>
        </View>
      </View>

      {/* Today progress */}
      <View style={[styles.glanceCard, { backgroundColor: theme.card, borderColor: theme.line, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }]}>
        <Eyebrow>TODAY</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <Text style={{ fontSize: 28, fontFamily: SERIF, color: theme.ink, letterSpacing: -0.5 }}>{totalToday}</Text>
          <Text style={{ color: theme.ink2, fontSize: 14 }}>
            appointment{totalToday === 1 ? '' : 's'} · {doneCount} done
          </Text>
        </View>
        {totalToday > 0 && (
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.bg2, marginTop: 12, overflow: 'hidden', alignSelf: 'stretch' }}>
            <View style={{ width: `${(doneCount / totalToday) * 100}%`, height: 4, backgroundColor: theme.accent }} />
          </View>
        )}
      </View>

      {/* Next free moment */}
      {nextFreeStart && nextFreeEnd && freeMins !== null && freeMins > 0 && (
        <View style={[styles.glanceCard, { backgroundColor: theme.card, borderColor: theme.line, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }]}>
          <Eyebrow>NEXT FREE MOMENT</Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <Text style={{ fontSize: 22, fontFamily: SERIF, color: theme.ink }}>
              {fmt.timeShort(nextFreeStart.toISOString())}
            </Text>
            <Text style={{ color: theme.ink3, fontSize: 14 }}>—</Text>
            <Text style={{ fontSize: 22, fontFamily: SERIF, color: theme.ink }}>
              {fmt.timeShort(nextFreeEnd.toISOString())}
            </Text>
          </View>
          <Text style={{ color: theme.ink2, fontSize: 13, marginTop: 8 }}>
            {fmtGap(freeMins)} to reset, restock or rest.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      {header}
      {welcome}
      <View style={{ paddingHorizontal: 36, paddingTop: 16 }}>{heroCard}</View>
      {isLandscape ? (
        <View style={{ flexDirection: 'row', gap: 28, paddingHorizontal: 36, paddingTop: 24 }}>
          {laterCol}
          {glanceCol}
        </View>
      ) : (
        <View style={{ paddingHorizontal: 28, paddingTop: 24, gap: 24 }}>
          {laterCol}
          {glanceCol}
        </View>
      )}
    </ScrollView>
  );
}

// ──────────────── Bits ────────────────

function Ring({ pct, accent }: { pct: number; accent: string }) {
  const size = 200;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - Math.max(0, Math.min(1, 1 - pct / 100)));
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={accent} strokeWidth={stroke} fill="none"
        strokeDasharray={`${C} ${C}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

/** Service chips for the hero: duration + up to 3 client-note sentences. */
function buildChips(appt: Appointment | undefined, client: Client | undefined): string[] {
  if (!appt) return [];
  const mins = Math.round((new Date(appt.end).getTime() - new Date(appt.start).getTime()) / 60000);
  const chips: string[] = [`${fmt.duration(mins)} service`];
  if (client?.notes) {
    const sentences = client.notes
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim().replace(/[.!?]$/, ''))
      .filter((s) => s.length > 0 && s.length < 50);
    chips.push(...sentences.slice(0, 3));
  }
  return chips;
}

function fmtGap(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`;
  const hours = mins / 60;
  if (hours < 1.25) return `1 hr`;
  if (hours < 1.75) return `1½ hrs`;
  if (Number.isInteger(hours)) return `${hours} hrs`;
  // Half-hour rounding for natural copy.
  const whole = Math.floor(hours);
  const frac = hours - whole;
  if (frac < 0.25) return `${whole} hrs`;
  if (frac < 0.75) return `${whole}½ hrs`;
  return `${whole + 1} hrs`;
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 36, paddingTop: 12, paddingBottom: 4 },
  modePill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  welcome: { fontSize: 52, fontFamily: SERIF, letterSpacing: -1, lineHeight: 56, marginTop: 8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 24, borderRadius: 28, padding: 28, minHeight: 240 },
  heroName: { fontSize: 32, fontFamily: SERIF, color: '#fff', letterSpacing: -0.5 },
  heroService: { color: '#fff', fontFamily: SERIF, fontSize: 28, lineHeight: 32, marginTop: 18, letterSpacing: -0.3 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  heroChip: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  ringInner: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringValue: { color: '#fff', fontSize: 44, fontFamily: SERIF, letterSpacing: -1, marginVertical: 2 },
  laterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderTopWidth: 0.5 },
  dashed: { borderWidth: 1, borderRadius: 14, padding: 16 },
  glanceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, borderWidth: 0.5 },
  checkChip: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
