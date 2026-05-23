import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, ScrollView, StyleSheet, Modal, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Card, Icons, StockBar, RoundBtn } from '../components';
import { Product } from '../data/types';
import { fmt } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function InventoryScreen() {
  const { theme, products, appointments, services } = useApp();
  const nav = useNavigation<Nav>();
  const [category, setCategory] = useState('all');
  const [listOpen, setListOpen] = useState(false);

  const suggestedBuy = (p: Product) => Math.ceil(Math.max(0, 2 * p.reorder - p.stock));

  const shareList = () => {
    const lines = lowStock.map((p) => `• ${p.name} (${p.brand}) — have ${p.stock}, buy ~${suggestedBuy(p)}`);
    Share.share({ message: `Iris shopping list\n\n${lines.join('\n')}` });
  };

  const cats = useMemo(() => {
    const unique = Array.from(new Set(products.map((p) => p.category)));
    return ['all', ...unique];
  }, [products]);

  const lowStock = products.filter((p) => p.status === 'low' || p.status === 'out');

  const filtered = useMemo(() => {
    const list = category === 'all' ? products : products.filter((p) => p.category === category);
    return [...list].sort((a, b) => {
      const order = { out: 0, low: 1, ok: 2 };
      return order[a.status] - order[b.status];
    });
  }, [products, category]);

  // Projected usage from upcoming appointments
  const projectedUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    const now = new Date();
    const week = new Date(now);
    week.setDate(week.getDate() + 7);
    appointments
      .filter((a) => a.status === 'upcoming' && new Date(a.start) >= now && new Date(a.start) <= week)
      .forEach((a) => {
        a.products.forEach((p) => {
          usage[p.productId] = (usage[p.productId] || 0) + 1;
        });
      });
    return usage;
  }, [appointments]);

  // Forecast: predicted product cost this week
  const predictedCost = useMemo(() => {
    return Object.entries(projectedUsage).reduce((sum, [pid, count]) => {
      const p = products.find((x) => x.id === pid);
      if (!p) return sum;
      return sum + p.cost * (p.perUse / p.size) * count;
    }, 0);
  }, [projectedUsage, products]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: theme.ink3 }]}>{products.length} ITEMS</Text>
          <Text style={[styles.title, { color: theme.ink }]}>Stock</Text>
        </View>
        <View style={styles.headerBtns}>
          <RoundBtn onPress={() => nav.navigate('ScanModal')} size={40}>
            <Icons.barcode size={18} color={theme.ink2} />
          </RoundBtn>
          <RoundBtn onPress={() => nav.navigate('StockTake')} size={40}>
            <Icons.clipboardCheck size={18} color={theme.ink2} />
          </RoundBtn>
          <RoundBtn onPress={() => nav.navigate('ProductForm', {})} filled size={40}>
            <Icons.plus size={18} color={theme.bg} />
          </RoundBtn>
        </View>
      </View>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
          <Card style={[styles.alertCard, { backgroundColor: 'rgba(192,126,42,0.10)', borderColor: theme.warn }]}>
            <View style={[styles.alertIcon, { backgroundColor: theme.warn }]}>
              <Icons.alert size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: theme.ink }]}>
                {lowStock.length} items low or out
              </Text>
              <Text style={[styles.alertSub, { color: theme.ink2 }]}>
                Forecast suggests restocking within 7 days
              </Text>
            </View>
            <Pressable
              onPress={() => setListOpen(true)}
              style={[styles.orderBtn, { backgroundColor: theme.heroBg }]}
            >
              <Text style={styles.orderBtnText}>List</Text>
            </Pressable>
          </Card>
        </View>
      )}

      {/* Forecast card */}
      <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
        <Card>
          <View style={styles.forecastHead}>
            <Icons.trend size={14} color={theme.accent} />
            <Text style={[styles.forecastEye, { color: theme.ink3 }]}>THIS WEEK · FORECAST</Text>
          </View>
          <View style={styles.forecastStats}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.forecastLabel, { color: theme.ink3 }]}>PREDICTED</Text>
              <Text style={[styles.forecastVal, { color: theme.ink }]}>{fmt.currency(predictedCost)}</Text>
              <Text style={[styles.forecastSub, { color: theme.ink2 }]}>product cost</Text>
            </View>
            <View style={[styles.forecastDivider, { backgroundColor: theme.line }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.forecastLabel, { color: theme.ink3 }]}>APPOINTMENTS</Text>
              <Text style={[styles.forecastVal, { color: theme.sage }]}>
                {appointments.filter((a) => {
                  const now = new Date();
                  const d = new Date(a.start);
                  const week = new Date(now);
                  week.setDate(week.getDate() + 7);
                  return a.status === 'upcoming' && d >= now && d <= week;
                }).length}
              </Text>
              <Text style={[styles.forecastSub, { color: theme.ink2 }]}>this week</Text>
            </View>
          </View>
        </Card>
      </View>

      {/* Category chips */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {cats.map((item, index) => (
            <Pressable
              key={item}
              onPress={() => setCategory(item)}
              style={[
                styles.chip, 
                { backgroundColor: category === item ? theme.accent : theme.bg2 },
                index < cats.length - 1 && { marginRight: 8 }
              ]}
            >
              <Text style={[styles.chipText, { color: category === item ? '#fff' : theme.ink2 }]}>
                {item === 'all' ? 'All' : item}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Product list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 8 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <ProductRow product={item} projected={projectedUsage[item.id] || 0} />
        )}
        ListEmptyComponent={
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontStyle: 'italic', color: theme.ink3 }}>
              No products in this category
            </Text>
          </View>
        }
      />

      {/* Shopping list */}
      <Modal visible={listOpen} transparent animationType="slide" onRequestClose={() => setListOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setListOpen(false)} />
        <View style={[styles.listSheet, { backgroundColor: theme.card }]}>
          <View style={[styles.listHandle, { backgroundColor: theme.ink3 }]} />
          <Text style={[styles.listTitle, { color: theme.ink }]}>Shopping list</Text>
          <Text style={[styles.listSub, { color: theme.ink3 }]}>
            {lowStock.length} item{lowStock.length === 1 ? '' : 's'} to restock
          </Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {lowStock.map((p) => (
              <View key={p.id} style={[styles.listRow, { borderBottomColor: theme.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.listName, { color: theme.ink }]}>{p.name}</Text>
                  <Text style={[styles.listMeta, { color: theme.ink3 }]}>
                    {p.brand} · have {p.stock}, reorder at {p.reorder}
                  </Text>
                </View>
                <Text style={[styles.listBuy, { color: theme.accent }]}>buy ~{suggestedBuy(p)}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={shareList} style={[styles.listShareBtn, { backgroundColor: theme.accent }]}>
            <Text style={styles.listShareText}>Share list</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ProductRow({ product, projected }: { product: Product; projected: number }) {
  const { theme } = useApp();
  const nav = useNavigation<Nav>();

  const statusColor = product.status === 'out' ? theme.danger
    : product.status === 'low' ? theme.warn
    : theme.sage;
  const statusLabel = product.status === 'out' ? 'OUT' : product.status === 'low' ? 'LOW' : 'OK';

  return (
    <Pressable
      onPress={() => nav.navigate('ProductDetail', { productId: product.id })}
      style={({ pressed }) => [
        styles.productCard,
        {
          backgroundColor: pressed ? theme.bg2 : theme.card,
          borderColor: product.status === 'out' ? theme.danger + '40'
            : product.status === 'low' ? theme.warn + '40'
            : theme.line,
        },
      ]}
    >
      {/* Top row */}
      <View style={styles.productTop}>
        <View style={[styles.productSwatch, { backgroundColor: theme.bg2 }]}>
          <Text style={[styles.productSwatchText, { color: theme.ink3 }]}>
            {product.brand.slice(0, 4).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.productName, { color: theme.ink }]} numberOfLines={1}>{product.name}</Text>
          <Text style={[styles.productBrand, { color: theme.ink2 }]}>
            {product.brand} · {product.category}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.stockNum, { color: theme.ink }]}>{product.stock}</Text>
          <Text style={[styles.stockUnit, { color: theme.ink3 }]}>× {product.size}{product.unit}</Text>
        </View>
      </View>

      {/* Stock bar */}
      <View style={{ marginBottom: 8 }}>
        <StockBar stock={product.stock} reorder={product.reorder} status={product.status} />
      </View>

      {/* Bottom row */}
      <View style={styles.productBottom}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {projected > 0 && (
          <Text style={[styles.projectedText, { color: theme.ink2 }]}>
            {projected} use{projected > 1 ? 's' : ''} this week
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  title: { fontSize: 34, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.5 },
  headerBtns: { flexDirection: 'row', gap: 8 },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 0.5,
    padding: 14,
    borderRadius: 16,
  },
  alertIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  alertTitle: { fontSize: 14, fontWeight: '600' },
  alertSub: { fontSize: 12, marginTop: 2 },
  orderBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  orderBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  listSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  listHandle: { width: 36, height: 4, borderRadius: 2, opacity: 0.35, alignSelf: 'center', marginBottom: 16 },
  listTitle: { fontSize: 18, fontWeight: '600', fontStyle: 'italic' },
  listSub: { fontSize: 12, marginTop: 2, marginBottom: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, gap: 10 },
  listName: { fontSize: 14, fontWeight: '600' },
  listMeta: { fontSize: 12, marginTop: 2 },
  listBuy: { fontSize: 14, fontWeight: '700' },
  listShareBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  listShareText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  forecastHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  forecastEye: { fontSize: 10, letterSpacing: 1.2, fontWeight: '500' },
  forecastStats: { flexDirection: 'row', gap: 12 },
  forecastDivider: { width: 0.5 },
  forecastLabel: { fontSize: 10, letterSpacing: 0.8, fontWeight: '500', marginBottom: 4 },
  forecastVal: { fontSize: 22, fontWeight: '500', letterSpacing: -0.5 },
  forecastSub: { fontSize: 11, marginTop: 2 },

  chipRow: { paddingHorizontal: 20, paddingBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '500' },

  productCard: {
    borderWidth: 0.5,
    borderRadius: 16,
    padding: 14,
  },
  productTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  productSwatch: {
    width: 46,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productSwatchText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  productName: { fontSize: 14, fontWeight: '600' },
  productBrand: { fontSize: 11, marginTop: 1 },
  stockNum: { fontSize: 18, fontWeight: '500', lineHeight: 20 },
  stockUnit: { fontSize: 9, letterSpacing: 0.5 },
  productBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  projectedText: { fontSize: 11 },
});
