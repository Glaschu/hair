import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Card, Avatar, Icons, RoundBtn } from '../components';
import { fmt } from '../data/utils';
import { Appointment, Product } from '../data/types';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Range = 'week' | 'month' | 'all';

const RANGE_OPTIONS: { id: Range; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getRangeBounds(range: Range): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date();

  if (range === 'week') {
    const start = new Date(now);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);

    const prevEnd = new Date(end);
    prevEnd.setDate(prevEnd.getDate() - 7);

    return { start, end, prevStart, prevEnd };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);

    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);

    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    prevEnd.setHours(23, 59, 59, 999);

    return { start, end, prevStart, prevEnd };
  }
  // all
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    start: new Date(0),
    end,
    prevStart: new Date(0),
    prevEnd: new Date(0),
  };
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const d = new Date(iso);
  return d >= start && d <= end;
}

export default function ReportsScreen() {
  const { theme, appointments, clients, products } = useApp();
  const nav = useNavigation<Nav>();
  const [range, setRange] = useState<Range>('week');
  const [marginMode, setMarginMode] = useState<'completed' | 'projected'>('completed');

  const { start, end, prevStart, prevEnd } = useMemo(() => getRangeBounds(range), [range]);

  const rangeStr = useMemo(() => {
    if (range === 'all') return '';
    const s = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const e = end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return ` · ${s.toUpperCase()} - ${e.toUpperCase()}`;
  }, [range, start, end]);

  const completed = useMemo(
    () => appointments.filter((a) => a.status === 'completed' && inRange(a.start, start, end)),
    [appointments, start, end]
  );
  const upcoming = useMemo(
    () => appointments.filter((a) => a.status === 'upcoming' && inRange(a.start, start, end)),
    [appointments, start, end]
  );
  const previous = useMemo(
    () => appointments.filter((a) => a.status === 'completed' && inRange(a.start, prevStart, prevEnd)),
    [appointments, prevStart, prevEnd]
  );

  const revenue = completed.reduce((s, a) => s + a.price, 0);
  const projectedRevenue = upcoming.reduce((s, a) => s + a.price, 0);
  const prevRevenue = previous.reduce((s, a) => s + a.price, 0);
  const revChange = prevRevenue > 0 && revenue > 0 && range !== 'all'
    ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100)
    : null;

  const unpaidAppts = useMemo(() => completed.filter((a) => !a.paid), [completed]);
  const outstanding = unpaidAppts.reduce((s, a) => s + a.price, 0);

  // Service breakdown
  const serviceCounts = useMemo(() => {
    const m: Record<string, number> = {};
    [...completed, ...upcoming].forEach((a) => {
      m[a.service] = (m[a.service] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [completed, upcoming]);

  // Product usage by cost
  const productUsage = useMemo(() => {
    const m: Record<string, number> = {};
    const appts = marginMode === 'completed' ? completed : [...completed, ...upcoming];
    appts.forEach((a) => {
      (a.products || []).forEach((up) => {
        m[up.productId] = (m[up.productId] || 0) + up.amount;
      });
    });
    return Object.entries(m)
      .map(([pid, amt]) => {
        const p = products.find((x) => x.id === pid);
        if (!p) return null;
        return { product: p, amount: amt, cost: p.cost * (amt / p.size) };
      })
      .filter((x): x is { product: Product; amount: number; cost: number } => x !== null)
      .sort((a, b) => b.cost - a.cost);
  }, [completed, upcoming, products, marginMode]);

  const productCost = productUsage.reduce((s, p) => s + p.cost, 0);
  const mRevenue = marginMode === 'completed' ? revenue : revenue + projectedRevenue;
  const margin = mRevenue - productCost;
  const marginPct = mRevenue > 0 ? Math.round((margin / mRevenue) * 100) : 0;
  const costPct = mRevenue > 0 ? Math.min(100, (productCost / mRevenue) * 100) : 0;

  // Day of week analysis
  const dayOfWeek = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    [...completed, ...upcoming].forEach((a) => {
      counts[new Date(a.start).getDay()]++;
    });
    return counts;
  }, [completed, upcoming]);
  const maxDow = Math.max(...dayOfWeek, 1);

  // Top clients by spend
  const clientSpend = useMemo(() => {
    const m: Record<string, number> = {};
    completed.forEach((a) => {
      m[a.clientId] = (m[a.clientId] || 0) + a.price;
    });
    return Object.entries(m)
      .map(([cid, spend]) => ({ client: clients.find((c) => c.id === cid), spend }))
      .filter((x): x is { client: NonNullable<typeof x['client']>; spend: number } => x.client !== undefined)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 4);
  }, [completed, clients]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <RoundBtn label="Back" onPress={() => nav.goBack()} size={38}>
            <Icons.chevronLeft size={18} color={theme.ink} />
          </RoundBtn>
          <View style={{ flex: 1, paddingHorizontal: 16 }}>
            <Text style={[styles.headerEye, { color: theme.ink3 }]}>PERFORMANCE</Text>
            <Text style={[styles.headerTitle, { color: theme.ink }]}>Reports</Text>
          </View>
        </View>

        {/* Range toggle */}
        <View style={{ paddingHorizontal: 20, marginBottom: 18 }}>
          <View style={[styles.rangeTrack, { backgroundColor: theme.bg2 }]}>
            {RANGE_OPTIONS.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setRange(o.id)}
                style={[
                  styles.rangeBtn,
                  range === o.id && [styles.rangeBtnActive, { backgroundColor: theme.card }],
                ]}
              >
                <Text style={[
                  styles.rangeBtnText,
                  { color: range === o.id ? theme.ink : theme.ink2 },
                  range === o.id && styles.rangeBtnTextActive,
                ]}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Revenue hero card */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View style={[styles.revenueCard, { backgroundColor: theme.heroBg }]}>
            <Text style={styles.revenueEyebrow}>REVENUE{rangeStr}</Text>
            <View style={styles.revenueRow}>
              <Text style={styles.revenueAmount}>{fmt.currency(revenue)}</Text>
              {revChange !== null && (
                <Text style={[styles.revChange, { color: revChange >= 0 ? '#A9C497' : '#E8A89C' }]}>
                  {revChange >= 0 ? '+' : ''}{revChange}%
                </Text>
              )}
            </View>
            <View style={styles.revSubcards}>
              <View style={styles.revSubcard}>
                <Text style={styles.revSubLabel}>COMPLETED</Text>
                <Text style={styles.revSubVal}>{completed.length}</Text>
              </View>
              <View style={styles.revSubcard}>
                <Text style={styles.revSubLabel}>BOOKED AHEAD</Text>
                <Text style={styles.revSubVal}>{fmt.currency(projectedRevenue)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Outstanding */}
        {unpaidAppts.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <Card>
              <View style={styles.outstandingHead}>
                <Text style={[styles.outstandingLabel, { color: theme.ink3 }]}>OUTSTANDING · UNPAID</Text>
                <Text style={[styles.outstandingAmount, { color: theme.warn }]}>{fmt.currency(outstanding)}</Text>
              </View>
              {unpaidAppts.map((a, i) => {
                const c = clients.find((x) => x.id === a.clientId);
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })}
                    style={[styles.unpaidRow, i > 0 && { borderTopWidth: 0.5, borderTopColor: theme.line }]}
                  >
                    <Text style={[styles.unpaidName, { color: theme.ink }]}>{c?.name ?? 'Unknown client'}</Text>
                    <Text style={[styles.unpaidAmt, { color: theme.ink2 }]}>{fmt.currency(a.price)}</Text>
                  </Pressable>
                );
              })}
            </Card>
          </View>
        )}

        {/* Margin */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <Pressable onPress={() => setMarginMode(m => m === 'completed' ? 'projected' : 'completed')}>
            <Card>
              <View style={styles.marginTop}>
                <View>
                  <Text style={[styles.cardEye, { color: theme.ink3 }]}>
                    {marginMode === 'completed' ? 'MARGIN · COMPLETED' : 'MARGIN · WITH PROJECTED'}
                  </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                  <Text style={[styles.marginAmount, { color: theme.ink }]}>{fmt.currency(margin)}</Text>
                  <Text style={[styles.marginPct, { color: theme.ink2 }]}>({marginPct}%)</Text>
                </View>
              </View>
              <Icons.trend size={20} color={theme.sage} />
            </View>
            <View style={[styles.marginBar, { backgroundColor: theme.bg2 }]}>
              {costPct > 0 && (
                <View style={{ width: `${costPct}%` as any, height: 8, backgroundColor: theme.warn }} />
              )}
              <View style={{ flex: 1, height: 8, backgroundColor: theme.sage }} />
            </View>
            <View style={styles.marginLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.warn }]} />
                <Text style={[styles.legendText, { color: theme.ink2 }]}>Product cost {fmt.currency(productCost)}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.sage }]} />
                <Text style={[styles.legendText, { color: theme.ink2 }]}>Margin {fmt.currency(margin)}</Text>
              </View>
            </View>
          </Card>
        </Pressable>
      </View>

        {/* Top services */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionEye, { color: theme.ink3 }]}>MOST BOOKED</Text>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Services</Text>
        </View>
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Card>
            {serviceCounts.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.ink3 }]}>No appointments yet</Text>
            ) : (
              serviceCounts.slice(0, 5).map(([name, count], i) => {
                const max = serviceCounts[0][1];
                return (
                  <View key={name} style={[styles.serviceRow, i > 0 && { borderTopWidth: 0.5, borderTopColor: theme.line }]}>
                    <View style={styles.serviceNameRow}>
                      <Text style={[styles.serviceName, { color: theme.ink }]}>{name}</Text>
                      <Text style={[styles.serviceCount, { color: theme.ink2 }]}>{count}</Text>
                    </View>
                    <View style={[styles.serviceBarBg, { backgroundColor: theme.bg2 }]}>
                      <View style={[styles.serviceBarFill, { width: `${(count / max) * 100}%` as any, backgroundColor: theme.accent }]} />
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </View>

        {/* Busiest days */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionEye, { color: theme.ink3 }]}>PATTERN</Text>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Busiest days</Text>
        </View>
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Card>
            <View style={styles.dowChart}>
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const count = dayOfWeek[dow];
                const barH = Math.round((count / maxDow) * 70) + 4;
                const isMax = count === maxDow && count > 0;
                return (
                  <View key={dow} style={styles.dowCol}>
                    <View style={styles.dowBarWrap}>
                      <View style={[
                        styles.dowBar,
                        {
                          height: barH,
                          backgroundColor: isMax ? theme.accent : theme.bg2,
                        },
                      ]} />
                    </View>
                    <Text style={[styles.dowLabel, { color: theme.ink3 }]}>
                      {DAY_NAMES[dow].slice(0, 2).toUpperCase()}
                    </Text>
                    <Text style={[styles.dowCount, { color: count > 0 ? theme.ink : theme.ink3 }]}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        </View>

        {/* Products used */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionEye, { color: theme.ink3 }]}>COSTLIEST</Text>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Products used</Text>
        </View>
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Card>
            {productUsage.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.ink3 }]}>No product usage recorded</Text>
            ) : (
              productUsage.slice(0, 5).map((row, i) => (
                <View
                  key={row.product.id}
                  style={[styles.productRow, i > 0 && { borderTopWidth: 0.5, borderTopColor: theme.line }]}
                >
                  <View style={[styles.productSwatch, { backgroundColor: theme.bg2 }]}>
                    <Text style={[styles.productSwatchText, { color: theme.ink3 }]}>
                      {row.product.brand.slice(0, 3).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.productName, { color: theme.ink }]} numberOfLines={1}>{row.product.name}</Text>
                    <Text style={[styles.productMeta, { color: theme.ink2 }]}>
                      {row.amount.toFixed(0)}{row.product.unit}
                    </Text>
                  </View>
                  <Text style={[styles.productCost, { color: theme.ink }]}>{fmt.currency(row.cost, 2)}</Text>
                </View>
              ))
            )}
          </Card>
        </View>

        {/* Top clients */}
        {clientSpend.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionEye, { color: theme.ink3 }]}>TOP SPEND</Text>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>Clients</Text>
            </View>
            <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
              <Card>
                {clientSpend.map((row, i) => (
                  <Pressable
                    key={row.client.id}
                    onPress={() => nav.navigate('ClientDetail', { clientId: row.client.id })}
                    style={[styles.clientRow, i > 0 && { borderTopWidth: 0.5, borderTopColor: theme.line }]}
                  >
                    <Avatar name={row.client.name} tone={row.client.tone} size={32} />
                    <Text style={[styles.clientName, { color: theme.ink }]}>{row.client.name}</Text>
                    <Text style={[styles.clientSpend, { color: theme.ink }]}>{fmt.currency(row.spend)}</Text>
                  </Pressable>
                ))}
              </Card>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerEye: { fontSize: 10, letterSpacing: 1.4, fontWeight: '400', marginBottom: 4 },
  headerTitle: { fontSize: 28, fontFamily: SERIF, letterSpacing: -0.5 },

  // Range toggle
  rangeTrack: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  rangeBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  rangeBtnActive: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  rangeBtnText: { fontSize: 13, fontWeight: '500' },
  rangeBtnTextActive: { fontWeight: '600' },

  // Revenue hero card
  revenueCard: { borderRadius: 20, padding: 22 },
  revenueEyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '500',
    marginBottom: 6,
  },
  revenueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 14 },
  revenueAmount: {
    fontSize: 46,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -1,
    lineHeight: 50,
  },
  revChange: { fontSize: 12, fontWeight: '700' },
  revSubcards: { flexDirection: 'row', gap: 8 },
  revSubcard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: 12,
  },
  revSubLabel: {
    fontSize: 9,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
    marginBottom: 4,
  },
  revSubVal: { fontSize: 18, fontWeight: '500', color: '#fff', letterSpacing: -0.3 },

  // Margin
  cardEye: { fontSize: 10, letterSpacing: 1.2, fontWeight: '500' },
  marginTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  marginAmount: { fontSize: 24, fontWeight: '500', letterSpacing: -0.5 },
  marginPct: { fontSize: 14 },
  marginBar: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', marginBottom: 8 },
  marginLegend: { flexDirection: 'row', justifyContent: 'space-between' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 11 },

  // Section head
  sectionHead: { paddingHorizontal: 20, marginBottom: 12 },
  sectionEye: { fontSize: 10, letterSpacing: 1.4, fontWeight: '400', marginBottom: 4 },
  sectionTitle: { fontSize: 22, fontFamily: SERIF, letterSpacing: -0.3 },
  outstandingHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
  outstandingLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '600' },
  outstandingAmount: { fontSize: 22, fontWeight: '600' },
  unpaidRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 },
  unpaidName: { fontSize: 14, fontWeight: '500' },
  unpaidAmt: { fontSize: 14, fontWeight: '600' },

  // Services
  serviceRow: { paddingVertical: 8 },
  serviceNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  serviceName: { fontSize: 13, fontWeight: '500' },
  serviceCount: { fontSize: 12 },
  serviceBarBg: { height: 4, borderRadius: 2, overflow: 'hidden' },
  serviceBarFill: { height: 4, borderRadius: 2 },

  // Day of week
  dowChart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 6 },
  dowCol: { flex: 1, alignItems: 'center', gap: 4 },
  dowBarWrap: { flex: 1, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  dowBar: { width: 24, borderRadius: 4, minHeight: 4 },
  dowLabel: { fontSize: 9, letterSpacing: 0.5, fontWeight: '500' },
  dowCount: { fontSize: 13, fontWeight: '500' },

  // Products
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  productSwatch: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  productSwatchText: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  productName: { fontSize: 13, fontWeight: '500' },
  productMeta: { fontSize: 10, marginTop: 2 },
  productCost: { fontSize: 16, fontWeight: '500' },

  // Clients
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  clientName: { flex: 1, fontSize: 13, fontWeight: '500' },
  clientSpend: { fontSize: 16, fontWeight: '500' },

  emptyText: { fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
});
