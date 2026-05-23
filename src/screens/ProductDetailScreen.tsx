import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Card, Icons, RoundBtn, StockBar } from '../components';
import { fmt } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen() {
  const { theme, products, setProducts, appointments, clients } = useApp();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const product = products.find((p) => p.id === route.params.productId);
  if (!product) return null;

  const statusColor = product.status === 'out' ? theme.danger
    : product.status === 'low' ? theme.warn
    : theme.sage;

  const upcomingAppts = useMemo(
    () =>
      appointments
        .filter((a) => a.status === 'upcoming' && a.products.some((p) => p.productId === product.id))
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [appointments, product.id]
  );

  const projectedTotal = upcomingAppts.length;
  const projectedAfterStock = product.size > 0
    ? product.stock - projectedTotal * (product.perUse / product.size)
    : product.stock;

  const usageHistory = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const day = 7 - i;
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const amount = appointments
        .filter(a =>
          a.status === 'completed' &&
          new Date(a.start) >= dayStart &&
          new Date(a.start) <= dayEnd &&
          a.products.some(p => p.productId === product.id)
        )
        .reduce((sum, a) => {
          const ap = a.products.find(p => p.productId === product.id);
          return sum + (ap?.amount ?? 0);
        }, 0);
      return { day, amount };
    });
  }, [appointments, product.id]);
  const maxUsage = Math.max(1, ...usageHistory.map((d) => d.amount));

  const [restockQty, setRestockQty] = useState(1);

  const restock = () => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== product.id) return p;
        const newStock = p.stock + restockQty;
        const status = newStock === 0 ? 'out' : newStock <= p.reorder ? 'low' : 'ok';
        return { ...p, stock: newStock, status };
      })
    );
    setRestockQty(1);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        {/* Nav */}
        <View style={styles.navRow}>
          <RoundBtn onPress={() => nav.goBack()} size={38}>
            <Icons.chevronLeft size={18} color={theme.ink} />
          </RoundBtn>
          <RoundBtn size={38} onPress={() => nav.navigate('ProductForm', { productId: product.id })}>
            <Icons.edit size={16} color={theme.ink} />
          </RoundBtn>
        </View>

        {/* Hero */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <View style={[styles.heroSwatch, { backgroundColor: theme.bg2 }]}>
            <Text style={[styles.heroSwatchText, { color: theme.ink3 }]}>
              {product.brand.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.heroEyebrow, { color: theme.ink3 }]}>
            {product.brand.toUpperCase()} · {product.category.toUpperCase()}
          </Text>
          <Text style={[styles.heroName, { color: theme.ink }]}>{product.name}</Text>
        </View>

        {/* Stock card */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Card>
            <View style={styles.stockHeader}>
              <View>
                <Text style={[styles.cardEye, { color: theme.ink3 }]}>IN STOCK</Text>
                <View style={styles.stockNumRow}>
                  <Text style={[styles.stockNum, { color: theme.ink }]}>{product.stock}</Text>
                  <Text style={[styles.stockUnit, { color: theme.ink2 }]}>
                    × {product.size}{product.unit}
                  </Text>
                </View>
              </View>
              <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
                <Text style={styles.statusPillText}>{product.status.toUpperCase()}</Text>
              </View>
            </View>
            <View style={{ marginBottom: 8 }}>
              <StockBar stock={product.stock} reorder={product.reorder} status={product.status} />
            </View>
            <View style={styles.stockMeta}>
              <Text style={[styles.stockMetaText, { color: theme.ink2 }]}>Reorder at {product.reorder}</Text>
              <Text style={[styles.stockMetaText, { color: theme.ink2 }]}>{product.perUse}{product.unit} per use</Text>
            </View>
          </Card>
        </View>

        {/* Forecast card */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 4 }]}>RECONCILIATION</Text>
          <Text style={[styles.sectionTitle, { color: theme.ink, marginBottom: 12 }]}>Forecast</Text>
          <Card>
            <View style={styles.forecastRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.forecastLabel, { color: theme.ink3 }]}>BOOKED USES</Text>
                <Text style={[styles.forecastBig, { color: theme.ink }]}>{projectedTotal}</Text>
                <Text style={[styles.forecastSub, { color: theme.ink2 }]}>next 7 days</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.forecastLabel, { color: theme.ink3 }]}>AFTER BOOKINGS</Text>
                <Text style={[styles.forecastBig, {
                  color: projectedAfterStock < product.reorder ? theme.warn : theme.ink,
                }]}>
                  {projectedAfterStock.toFixed(1)}
                </Text>
                <Text style={[styles.forecastSub, { color: theme.ink2 }]}>{product.unit} remaining</Text>
              </View>
            </View>

            {upcomingAppts.length > 0 && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.line }]} />
                <Text style={[styles.cardEye, { color: theme.ink3, marginBottom: 10 }]}>BOOKED INTO</Text>
                {upcomingAppts.map((appt, i) => {
                  const c = clients.find((x) => x.id === appt.clientId);
                  return (
                    <Pressable
                      key={appt.id}
                      onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
                      style={({ pressed }) => [
                        styles.apptRow,
                        { borderBottomColor: theme.line, opacity: pressed ? 0.7 : 1 },
                        i === upcomingAppts.length - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      {c && <Avatar name={c.name} tone={c.tone} size={28} />}
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.apptName, { color: theme.ink }]}>{c?.name}</Text>
                        <Text style={[styles.apptSvc, { color: theme.ink2 }]}>{appt.service}</Text>
                      </View>
                      <Text style={[styles.apptRel, { color: theme.ink3 }]}>{fmt.rel(appt.start)}</Text>
                    </Pressable>
                  );
                })}
              </>
            )}
          </Card>
        </View>

        {/* Usage chart */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 4 }]}>LAST 7 DAYS</Text>
          <Text style={[styles.sectionTitle, { color: theme.ink, marginBottom: 12 }]}>Usage</Text>
          <Card>
            <View style={styles.chartWrap}>
              {usageHistory.map((d, i) => (
                <View key={i} style={styles.chartCol}>
                  <View style={styles.chartBarWrap}>
                    <View style={[
                      styles.chartBar,
                      {
                        height: Math.max(4, (d.amount / maxUsage) * 70),
                        backgroundColor: d.amount === 0 ? theme.bg2 : theme.accent,
                        opacity: d.day === 0 ? 1 : 0.65,
                      },
                    ]} />
                  </View>
                  <Text style={[styles.chartLabel, { color: theme.ink3 }]}>
                    {d.day === 0 ? 'Now' : `-${d.day}`}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </View>

        {/* Cost info */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 4 }]}>ECONOMICS</Text>
          <Text style={[styles.sectionTitle, { color: theme.ink, marginBottom: 12 }]}>Cost</Text>
          <Card>
            <View style={styles.costRow}>
              <CostStat label="Unit cost" value={fmt.currency(product.cost)} theme={theme} />
              <CostStat label="Per use" value={fmt.currency(product.cost * product.perUse / product.size, 2)} theme={theme} />
              <CostStat label="Stock value" value={fmt.currency(product.cost * product.stock)} theme={theme} />
            </View>
          </Card>
        </View>
      </ScrollView>

      {/* Quick actions */}
      <View style={[styles.actionsWrap, { backgroundColor: theme.bg }]}>
        <View style={styles.qtyRow}>
          <Text style={[styles.qtyLabel, { color: theme.ink3 }]}>QUANTITY</Text>
          <View style={styles.qtyStepper}>
            <Pressable
              onPress={() => setRestockQty((q) => Math.max(1, q - 1))}
              hitSlop={8}
              style={[styles.qtyBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
            >
              <Text style={[styles.qtyBtnText, { color: theme.ink2 }]}>−</Text>
            </Pressable>
            <Text style={[styles.qtyValue, { color: theme.ink }]}>{restockQty}</Text>
            <Pressable
              onPress={() => setRestockQty((q) => q + 1)}
              hitSlop={8}
              style={[styles.qtyBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
            >
              <Text style={[styles.qtyBtnText, { color: theme.ink2 }]}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.actionsRow}>
          <Pressable
            onPress={restock}
            style={[styles.restockBtn, { backgroundColor: theme.heroBg }]}
          >
            <Icons.plus size={16} color="#fff" strokeWidth={2.2} />
            <Text style={styles.restockBtnText}>Restock +{restockQty}</Text>
          </Pressable>
          <Pressable
            onPress={() => nav.navigate('ScanModal')}
            style={[styles.scanBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
          >
            <Icons.barcode size={18} color={theme.ink} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function CostStat({ label, value, theme }: { label: string; value: string; theme: any }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{value}</Text>
      <Text style={{ fontSize: 10, color: theme.ink3, marginTop: 4, letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },

  // Hero
  heroSwatch: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  heroSwatchText: { fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500', marginBottom: 6 },
  heroName: { fontSize: 28, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.3, lineHeight: 32 },

  // Stock card
  stockHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardEye: { fontSize: 10, letterSpacing: 1.2, fontWeight: '500', marginBottom: 4 },
  stockNumRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  stockNum: { fontSize: 44, fontWeight: '500', letterSpacing: -1, lineHeight: 48 },
  stockUnit: { fontSize: 12 },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  statusPillText: { color: '#fff', fontSize: 10, letterSpacing: 1.2, fontWeight: '700' },
  stockMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  stockMetaText: { fontSize: 11 },

  sectionEye: { fontSize: 10, letterSpacing: 1.4, fontWeight: '400' },
  sectionTitle: { fontSize: 22, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.3 },

  // Forecast
  forecastRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  forecastLabel: { fontSize: 9, letterSpacing: 1, fontWeight: '500', marginBottom: 4 },
  forecastBig: { fontSize: 28, fontWeight: '500', letterSpacing: -0.5, lineHeight: 32 },
  forecastSub: { fontSize: 11, marginTop: 4 },
  divider: { height: 0.5, marginVertical: 14 },
  apptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  apptName: { fontSize: 13, fontWeight: '500' },
  apptSvc: { fontSize: 11, marginTop: 1 },
  apptRel: { fontSize: 10, fontWeight: '500' },

  // Chart
  chartWrap: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 6 },
  chartCol: { flex: 1, alignItems: 'center', gap: 6 },
  chartBarWrap: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', width: '100%' },
  chartBar: { width: 22, borderRadius: 4, minHeight: 4 },
  chartLabel: { fontSize: 8, letterSpacing: 0.5 },

  // Cost
  costRow: { flexDirection: 'row', justifyContent: 'space-around' },

  // Actions
  actionsWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
  },
  actionsRow: { flexDirection: 'row', gap: 10 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  qtyLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '600' },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 20, fontWeight: '500' },
  qtyValue: { fontSize: 18, fontWeight: '700', minWidth: 32, textAlign: 'center' },
  restockBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  restockBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  scanBtn: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
  },
});
