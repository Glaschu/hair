import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../../data/AppContext';
import { useResponsive } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';
import { Icons, StockBar, RoundBtn, Avatar } from '../../components';
import { fmt } from '../../data/utils';
import { Product } from '../../data/types';
import { Eyebrow, Title, Btn } from '../ui';
import { useShell } from '../shellContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_ORDER = { out: 0, low: 1, ok: 2 } as const;

export function InventoryIPad() {
  const { theme, products, appointments } = useApp();
  const { isLandscape } = useResponsive();
  const { selectedProductId, setSelectedProductId } = useShell();
  const nav = useNavigation<Nav>();
  const [category, setCategory] = useState('all');

  const cats = useMemo(() => ['all', ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const lowStock = products.filter((p) => p.status === 'low' || p.status === 'out');
  const filtered = useMemo(() => {
    const list = category === 'all' ? products : products.filter((p) => p.category === category);
    return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }, [products, category]);

  const projectedUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    const now = new Date(); const week = new Date(now); week.setDate(week.getDate() + 7);
    appointments
      .filter((a) => a.status === 'upcoming' && new Date(a.start) >= now && new Date(a.start) <= week)
      .forEach((a) => a.products.forEach((p) => { usage[p.productId] = (usage[p.productId] || 0) + 1; }));
    return usage;
  }, [appointments]);

  useEffect(() => {
    if (!isLandscape) return;
    const exists = selectedProductId && products.some((p) => p.id === selectedProductId);
    if (!exists) setSelectedProductId(filtered[0]?.id ?? products[0]?.id ?? null);
  }, [isLandscape, selectedProductId, products, filtered, setSelectedProductId]);

  const onSelect = (p: Product) => {
    if (isLandscape) setSelectedProductId(p.id);
    else nav.navigate('ProductDetail', { productId: p.id });
  };

  const list = (
    <View style={[styles.listPane, isLandscape && { width: 380, borderRightWidth: 0.5, borderRightColor: theme.line }]}>
      <View style={{ paddingHorizontal: 28, paddingTop: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>{products.length} ITEMS</Eyebrow>
            <Title size={isLandscape ? 32 : 30} style={{ marginTop: 2 }}>Stock</Title>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <RoundBtn size={40} onPress={() => nav.navigate('ScanModal')}><Icons.barcode size={18} color={theme.ink2} /></RoundBtn>
            <RoundBtn size={40} onPress={() => nav.navigate('StockTake')}><Icons.clipboardCheck size={18} color={theme.ink2} /></RoundBtn>
            <RoundBtn filled size={40} onPress={() => nav.navigate('ProductForm', {})}><Icons.plus size={18} color={theme.bg} /></RoundBtn>
          </View>
        </View>
        {lowStock.length > 0 && (
          <Pressable onPress={() => nav.navigate('StockTake')} style={[styles.alert, { backgroundColor: theme.accent + '1A' }]}>
            <View style={[styles.alertIcon, { backgroundColor: theme.warn }]}><Icons.alert size={20} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: theme.ink }}>{lowStock.length} items low or out</Text>
              <Text style={{ color: theme.ink2, fontSize: 13 }}>Forecast suggests restocking within 7 days</Text>
            </View>
          </Pressable>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, marginBottom: 8 }} contentContainerStyle={{ gap: 8 }}>
          {cats.map((c) => (
            <Pressable key={c} onPress={() => setCategory(c)} style={[styles.cat, { backgroundColor: category === c ? theme.accent : theme.bg2 }]}>
              <Text style={{ fontSize: 13, fontWeight: '500', color: category === c ? '#fff' : theme.ink2 }}>{c === 'all' ? 'All' : c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: 24, gap: 8 }} showsVerticalScrollIndicator={false}>
        {filtered.map((p) => (
          <StockRow key={p.id} product={p} projected={projectedUsage[p.id] || 0} selected={isLandscape && p.id === selectedProductId} onPress={() => onSelect(p)} />
        ))}
      </ScrollView>
    </View>
  );

  if (!isLandscape) return <View style={{ flex: 1 }}>{list}</View>;

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {list}
      <View style={{ flex: 1, minWidth: 0 }}>
        {selectedProductId
          ? <ProductDetailPanel productId={selectedProductId} />
          : <View style={styles.emptyDetail}><Text style={{ color: theme.ink3, fontStyle: 'italic' }}>Select a product</Text></View>}
      </View>
    </View>
  );
}

function StockRow({ product, projected, selected, onPress }: { product: Product; projected: number; selected: boolean; onPress: () => void }) {
  const { theme } = useApp();
  const statusColor = product.status === 'out' ? theme.danger : product.status === 'low' ? theme.warn : theme.sage;
  return (
    <Pressable onPress={onPress} style={[styles.stockRow, { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.line, borderWidth: selected ? 1.5 : 0.5 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={[styles.swatch, { backgroundColor: theme.bg2 }]}><Text style={{ fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: theme.ink3 }}>{product.brand.slice(0, 4).toUpperCase()}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', fontSize: 15, color: theme.ink }} numberOfLines={1}>{product.name}</Text>
          <Text style={{ color: theme.ink2, fontSize: 12 }} numberOfLines={1}>{product.brand} · {product.category}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 22, fontWeight: '500', fontStyle: 'italic', color: theme.ink, lineHeight: 24 }}>{product.stock}</Text>
          <Text style={{ color: theme.ink3, fontSize: 11 }}>× {product.size}{product.unit}</Text>
        </View>
      </View>
      <View style={{ marginTop: 12 }}><StockBar stock={product.stock} reorder={product.reorder} status={product.status} /></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
        {product.status !== 'ok' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
            <Text style={{ fontSize: 10, letterSpacing: 1, fontWeight: '700', color: statusColor }}>{product.status.toUpperCase()}</Text>
          </View>
        )}
        {projected > 0 && <Text style={{ color: theme.ink2, fontSize: 11, marginLeft: 'auto' }}>{projected} use{projected > 1 ? 's' : ''} this week</Text>}
      </View>
    </Pressable>
  );
}

function ProductDetailPanel({ productId }: { productId: string }) {
  const { theme, products, setProducts, appointments, clients } = useApp();
  const nav = useNavigation<Nav>();
  const product = products.find((p) => p.id === productId);
  if (!product) return null;

  const statusColor = product.status === 'out' ? theme.danger : product.status === 'low' ? theme.warn : theme.sage;
  const setStock = (next: number) => setProducts((prev) => prev.map((p) => {
    if (p.id !== product.id) return p;
    const stock = Math.max(0, next);
    const status = stock === 0 ? 'out' : stock <= p.reorder ? 'low' : 'ok';
    return { ...p, stock, status };
  }));

  const upcoming = useMemo(() => appointments
    .filter((a) => a.status === 'upcoming' && a.products.some((p) => p.productId === product.id))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()), [appointments, product.id]);

  const recentUses = useMemo(() => appointments
    .filter((a) => a.status === 'completed' && a.products.some((p) => p.productId === product.id))
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    .slice(0, 4), [appointments, product.id]);

  const usage = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const day = 7 - i;
    const start = new Date(); start.setDate(start.getDate() - day); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    const amount = appointments
      .filter((a) => a.status === 'completed' && new Date(a.start) >= start && new Date(a.start) <= end && a.products.some((p) => p.productId === product.id))
      .reduce((s, a) => s + (a.products.find((p) => p.productId === product.id)?.amount ?? 0), 0);
    return { day, amount };
  }), [appointments, product.id]);
  const maxUsage = Math.max(1, ...usage.map((u) => u.amount));
  const suggestedBuy = Math.ceil(Math.max(1, 2 * product.reorder - product.stock));

  return (
    <ScrollView contentContainerStyle={{ padding: 28, gap: 16 }} showsVerticalScrollIndicator={false}>
      {/* Header card */}
      <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={[styles.bigSwatch, { backgroundColor: theme.bg2 }]}><Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: theme.ink3 }}>{product.brand.slice(0, 4).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Eyebrow>{product.brand.toUpperCase()} · {product.category.toUpperCase()}</Eyebrow>
            <Title size={26} style={{ marginTop: 2 }}>{product.name}</Title>
            <Text style={{ color: theme.ink2, fontSize: 13, marginTop: 4 }}>{product.size}{product.unit} · {fmt.currency(product.cost)} each</Text>
          </View>
          <RoundBtn size={38} onPress={() => nav.navigate('ProductForm', { productId: product.id })}><Icons.edit size={16} color={theme.ink} /></RoundBtn>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
          <View style={[styles.box, { backgroundColor: theme.bg2 }]}>
            <Eyebrow>ON HAND</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 }}>
              <RoundBtn size={34} onPress={() => setStock(product.stock - 1)}><Icons.close size={14} color={theme.ink2} /></RoundBtn>
              <Text style={{ fontSize: 34, fontWeight: '500', fontStyle: 'italic', color: theme.ink, minWidth: 36, textAlign: 'center' }}>{product.stock}</Text>
              <RoundBtn size={34} onPress={() => setStock(product.stock + 1)}><Icons.plus size={14} color={theme.ink2} /></RoundBtn>
            </View>
          </View>
          <View style={[styles.box, { backgroundColor: theme.bg2 }]}>
            <Eyebrow>REORDER AT</Eyebrow>
            <Text style={{ fontSize: 34, fontWeight: '500', fontStyle: 'italic', color: theme.ink, marginTop: 8 }}>{product.reorder}<Text style={{ fontSize: 12, color: theme.ink3, fontStyle: 'normal' }}>  {product.unit}</Text></Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
            <Text style={{ fontSize: 10, letterSpacing: 1, fontWeight: '700', color: statusColor }}>{product.status === 'ok' ? 'IN STOCK' : product.status === 'low' ? 'LOW STOCK' : 'OUT OF STOCK'}</Text>
          </View>
          <Text style={{ color: theme.ink2, fontSize: 12 }}>{upcoming.length} booked this week</Text>
        </View>
      </View>

      {/* Usage chart */}
      <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Eyebrow style={{ flex: 1 }}>USAGE · LAST 8 DAYS</Eyebrow>
          <Text style={{ color: theme.ink3, fontSize: 11 }}>{product.perUse}{product.unit} / use</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 4, marginTop: 14 }}>
          {usage.map((u, i) => (
            <View key={i} style={{ flex: 1, height: Math.max(4, (u.amount / maxUsage) * 60), borderRadius: 3, backgroundColor: u.amount === 0 ? theme.bg2 : theme.accent, opacity: u.day === 0 ? 1 : 0.6 }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ color: theme.ink3, fontSize: 10 }}>7 days ago</Text>
          <Text style={{ color: theme.ink3, fontSize: 10 }}>today</Text>
        </View>
      </View>

      {/* Recent uses */}
      <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <Eyebrow>RECENT USES</Eyebrow>
        {recentUses.length === 0 ? (
          <Text style={{ color: theme.ink3, fontStyle: 'italic', fontSize: 13, marginTop: 8 }}>Not used in any completed appointment yet.</Text>
        ) : (
          <View style={{ marginTop: 12, gap: 12 }}>
            {recentUses.map((a) => {
              const c = clients.find((x) => x.id === a.clientId);
              const amt = a.products.find((p) => p.productId === product.id)?.amount ?? 0;
              return (
                <Pressable key={a.id} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: a.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ width: 56, color: theme.ink3, fontSize: 12 }}>{new Date(a.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
                  {c && <Avatar name={c.name} tone={c.tone} size={28} />}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '500', fontSize: 13, color: theme.ink }} numberOfLines={1}>{c?.name}</Text>
                    <Text style={{ color: theme.ink3, fontSize: 11 }} numberOfLines={1}>{a.service}</Text>
                  </View>
                  <Text style={{ color: theme.ink2, fontSize: 13 }}>{amt}{product.unit}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <Btn variant="primary" style={{ justifyContent: 'center', paddingVertical: 14 }} icon={<Icons.plus size={16} color="#fff" />} onPress={() => setStock(product.stock + suggestedBuy)}>
        Restock +{suggestedBuy}
      </Btn>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  listPane: { height: '100%' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 14, marginTop: 14 },
  alertIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cat: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  stockRow: { borderRadius: 14, padding: 16 },
  swatch: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emptyDetail: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { borderRadius: 16, borderWidth: 0.5, padding: 20 },
  bigSwatch: { width: 64, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  box: { flex: 1, borderRadius: 14, padding: 14 },
});
