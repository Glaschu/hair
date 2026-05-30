import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Share } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useApp } from '../../data/AppContext';
import { useResponsive } from '../../hooks/useResponsive';
import { useShell } from '../shellContext';
import { Avatar, Icons } from '../../components';
import { fmt } from '../../data/utils';
import { Product } from '../../data/types';
import { Eyebrow, Title, Btn, StatTile } from '../ui';

type Range = 'week' | 'month' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'week', label: '7 days' }, { id: 'month', label: '30 days' }, { id: 'all', label: 'All time' },
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function rangeBounds(range: Range) {
  const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999);
  const span = range === 'week' ? 6 : range === 'month' ? 29 : null;
  if (span === null) return { start: new Date(0), end };
  const start = new Date(now); start.setDate(start.getDate() - span); start.setHours(0, 0, 0, 0);
  return { start, end };
}

export function ReportsIPad() {
  const { theme, appointments, clients, products } = useApp();
  const { isLandscape } = useResponsive();
  const { goToClient } = useShell();
  const [range, setRange] = useState<Range>('week');
  const { start, end } = useMemo(() => rangeBounds(range), [range]);
  const inRange = (iso: string) => { const d = new Date(iso); return d >= start && d <= end; };

  const completed = useMemo(() => appointments.filter((a) => a.status === 'completed' && inRange(a.start)), [appointments, start, end]);
  const upcoming = useMemo(() => appointments.filter((a) => a.status === 'upcoming' && inRange(a.start)), [appointments, start, end]);

  const revenue = completed.reduce((s, a) => s + a.price, 0);
  const projected = upcoming.reduce((s, a) => s + a.price, 0);
  const avgTicket = completed.length ? Math.round(revenue / completed.length) : 0;

  const serviceCounts = useMemo(() => {
    const m: Record<string, number> = {};
    [...completed, ...upcoming].forEach((a) => { m[a.service] = (m[a.service] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [completed, upcoming]);

  const productUsage = useMemo(() => {
    const m: Record<string, number> = {};
    [...completed, ...upcoming].forEach((a) => a.products.forEach((up) => { m[up.productId] = (m[up.productId] || 0) + up.amount; }));
    return Object.entries(m).map(([pid, amt]) => {
      const p = products.find((x) => x.id === pid);
      return p ? { product: p, amount: amt, cost: p.cost * (amt / p.size) } : null;
    }).filter((x): x is { product: Product; amount: number; cost: number } => x !== null).sort((a, b) => b.cost - a.cost);
  }, [completed, upcoming, products]);

  const productCost = productUsage.reduce((s, p) => s + p.cost, 0);
  const totalRev = revenue + projected;
  const margin = totalRev - productCost;
  const marginPct = totalRev > 0 ? Math.round((margin / totalRev) * 100) : 0;
  const costPct = totalRev > 0 ? Math.min(100, (productCost / totalRev) * 100) : 0;

  const dayOfWeek = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    [...completed, ...upcoming].forEach((a) => counts[new Date(a.start).getDay()]++);
    return counts;
  }, [completed, upcoming]);
  const maxDow = Math.max(1, ...dayOfWeek);

  const clientSpend = useMemo(() => {
    const m: Record<string, number> = {};
    completed.forEach((a) => { m[a.clientId] = (m[a.clientId] || 0) + a.price; });
    return Object.entries(m).map(([cid, spend]) => ({ client: clients.find((c) => c.id === cid), spend }))
      .filter((x): x is { client: NonNullable<typeof x['client']>; spend: number } => x.client !== undefined)
      .sort((a, b) => b.spend - a.spend).slice(0, 5);
  }, [completed, clients]);

  // Sparkline: completed revenue over the last 10 days.
  const spark = useMemo(() => Array.from({ length: 10 }, (_, i) => {
    const day = 9 - i;
    const s = new Date(); s.setDate(s.getDate() - day); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setHours(23, 59, 59, 999);
    return appointments.filter((a) => a.status === 'completed' && new Date(a.start) >= s && new Date(a.start) <= e).reduce((sum, a) => sum + a.price, 0);
  }), [appointments]);

  const onExport = () => {
    const lines = [
      `Iris · Reports (${RANGES.find((r) => r.id === range)?.label})`,
      `Revenue: ${fmt.currency(revenue)}  ·  Booked ahead: ${fmt.currency(projected)}`,
      `Margin: ${fmt.currency(margin)} (${marginPct}%)  ·  Product cost: ${fmt.currency(productCost)}`,
      '', 'Top services:',
      ...serviceCounts.slice(0, 5).map(([n, c]) => `• ${n} — ${c}`),
    ];
    Share.share({ message: lines.join('\n') });
  };

  const pad = isLandscape ? 32 : 28;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: pad, paddingTop: 18, paddingBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>PERFORMANCE</Eyebrow>
          <Title size={isLandscape ? 34 : 30} style={{ marginTop: 2 }}>Reports</Title>
        </View>
        <View style={[styles.toggle, { backgroundColor: theme.bg2 }]}>
          {RANGES.map((r) => (
            <Pressable key={r.id} onPress={() => setRange(r.id)} style={[styles.toggleBtn, range === r.id && { backgroundColor: theme.card }]}>
              <Text style={{ fontSize: 13, fontWeight: '500', color: range === r.id ? theme.ink : theme.ink3 }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <Btn icon={<Icons.arrowRight size={15} color={theme.ink} />} onPress={onExport}>Export</Btn>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 28, gap: 18 }} showsVerticalScrollIndicator={false}>
        {/* Dark hero */}
        <View style={[styles.hero, { backgroundColor: theme.heroBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 24 }}>
            <View style={{ flex: 1.4 }}>
              <Text style={styles.heroEye}>REVENUE</Text>
              <Text style={styles.heroAmount}>{fmt.currency(revenue)}</Text>
            </View>
            <StatTile dark label="Completed" value={String(completed.length)} />
            <StatTile dark label="Booked ahead" value={fmt.currency(projected)} />
            <StatTile dark label="Avg ticket" value={avgTicket > 0 ? fmt.currency(avgTicket) : '—'} />
          </View>
          <Sparkline data={spark} color={theme.accent} />
        </View>

        {/* Margin + Busiest days */}
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line, flex: 1.3 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Eyebrow>MARGIN</Eyebrow>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                  <Text style={{ fontSize: 40, fontWeight: '500', fontStyle: 'italic', color: theme.ink, letterSpacing: -1 }}>{fmt.currency(margin)}</Text>
                  <Text style={{ color: theme.sage, fontSize: 14, fontWeight: '600' }}>({marginPct}%)</Text>
                </View>
              </View>
              <Icons.trend size={26} color={theme.sage} />
            </View>
            <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 20, backgroundColor: theme.bg2 }}>
              {costPct > 0 && <View style={{ width: `${costPct}%`, backgroundColor: theme.warn }} />}
              <View style={{ flex: 1, backgroundColor: theme.sage }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <Legend color={theme.warn} label={`Product cost ${fmt.currency(productCost)}`} />
              <Legend color={theme.sage} label={`Margin ${fmt.currency(margin)}`} />
            </View>
          </View>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line, flex: 1 }]}>
            <Eyebrow>PATTERN · BUSIEST DAYS</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 6, marginTop: 14 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const count = dayOfWeek[dow];
                const isMax = count === maxDow && count > 0;
                return (
                  <View key={dow} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                    <View style={{ flex: 1, justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
                      <View style={{ width: '78%', maxWidth: 30, height: Math.round((count / maxDow) * 80) + 4, borderRadius: 4, backgroundColor: isMax ? theme.accent : theme.accent + '33' }} />
                    </View>
                    <Text style={{ fontSize: 9, letterSpacing: 0.5, color: theme.ink3, fontWeight: '500' }}>{DAY_NAMES[dow].slice(0, 2).toUpperCase()}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: count > 0 ? theme.ink : theme.ink3 }}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Most booked services */}
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <Eyebrow>MOST BOOKED · SERVICES</Eyebrow>
          {serviceCounts.length === 0 ? (
            <Text style={{ color: theme.ink3, fontStyle: 'italic', marginTop: 10 }}>No appointments yet</Text>
          ) : (
            <View style={{ marginTop: 14, gap: 12 }}>
              {serviceCounts.slice(0, 6).map(([name, count]) => (
                <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Text style={{ width: 200, fontWeight: '600', fontSize: 14, color: theme.ink }} numberOfLines={1}>{name}</Text>
                  <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.bg2, overflow: 'hidden' }}>
                    <View style={{ width: `${(count / serviceCounts[0][1]) * 100}%`, height: 6, backgroundColor: theme.accent }} />
                  </View>
                  <Text style={{ width: 28, textAlign: 'right', fontWeight: '600', color: theme.ink }}>{count}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Products + Top clients */}
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line, flex: 1 }]}>
            <Eyebrow>COSTLIEST · PRODUCTS USED</Eyebrow>
            {productUsage.length === 0 ? (
              <Text style={{ color: theme.ink3, fontStyle: 'italic', marginTop: 10 }}>No product usage recorded</Text>
            ) : (
              <View style={{ marginTop: 12 }}>
                {productUsage.slice(0, 5).map((row, i) => (
                  <View key={row.product.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: i > 0 ? 0.5 : 0, borderTopColor: theme.line }}>
                    <View style={[styles.swatch, { backgroundColor: theme.bg2 }]}><Text style={{ fontSize: 8, fontWeight: '700', color: theme.ink3 }}>{row.product.brand.slice(0, 3).toUpperCase()}</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: '600', fontSize: 14, color: theme.ink }} numberOfLines={1}>{row.product.name}</Text>
                      <Text style={{ color: theme.ink2, fontSize: 11 }}>{row.amount.toFixed(0)}{row.product.unit}</Text>
                    </View>
                    <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>{fmt.currency(row.cost, 2)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          {clientSpend.length > 0 && (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line, flex: 1 }]}>
              <Eyebrow>TOP SPEND · CLIENTS</Eyebrow>
              <View style={{ marginTop: 12 }}>
                {clientSpend.map((row, i) => (
                  <Pressable key={row.client.id} onPress={() => goToClient(row.client.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i > 0 ? 0.5 : 0, borderTopColor: theme.line }}>
                    <Avatar name={row.client.name} tone={row.client.tone} size={32} />
                    <Text style={{ flex: 1, fontWeight: '500', fontSize: 14, color: theme.ink }} numberOfLines={1}>{row.client.name}</Text>
                    <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>{fmt.currency(row.spend)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const { theme } = useApp();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: theme.ink2 }}>{label}</Text>
    </View>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  const W = 280, H = 56;
  const step = W / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${i * step},${H - (v / max) * (H - 6) - 3}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={56} preserveAspectRatio="none" style={{ marginTop: 16 }}>
      <Defs>
        <LinearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#rev)" />
      <Path d={line} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', borderRadius: 999, padding: 4 },
  toggleBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
  hero: { borderRadius: 22, padding: 28 },
  heroEye: { fontSize: 10, letterSpacing: 1.4, color: 'rgba(255,255,255,0.55)', fontWeight: '500', marginBottom: 6 },
  heroAmount: { fontSize: 60, fontWeight: '500', color: '#fff', letterSpacing: -1.5, lineHeight: 62 },
  card: { borderRadius: 18, borderWidth: 0.5, padding: 22 },
  swatch: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
