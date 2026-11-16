import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Chip, Icons } from '../components';
import { sanitizeStockInput, parseStockInput, formatStockInput, stockStatus } from '../data/stock';
import { Product } from '../data/types';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function StockTakeScreen() {
  const { theme, products, setProducts } = useApp();
  const nav = useNavigation<Nav>();
  const [cat, setCat] = useState('all');

  // Held as text, not numbers: a numeric state would swallow the decimal
  // point as it's typed, making "3.5" impossible to enter.
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const obj: Record<string, string> = {};
    products.forEach((p) => { obj[p.id] = formatStockInput(p.stock); });
    return obj;
  });

  /** The counted number for a product, falling back to its current stock. */
  const countFor = (p: Product) => parseStockInput(counts[p.id] ?? '') ?? p.stock;

  const cats = useMemo(() => {
    const unique = Array.from(new Set(products.map((p) => p.category)));
    return ['all', ...unique];
  }, [products]);

  const filtered = cat === 'all' ? products : products.filter((p) => p.category === cat);

  const changedCount = products.filter((p) => Math.abs(countFor(p) - p.stock) > 0.001).length;

  const handleSave = () => {
    setProducts((ps) =>
      ps.map((p) => {
        // A field left blank means "not counted" — keep what was there
        // rather than zeroing the shelf.
        const newStock = Math.max(0, countFor(p));
        return { ...p, stock: newStock, status: stockStatus(newStock, p.reorder) };
      })
    );
    nav.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => nav.goBack()}
          hitSlop={8}
          style={({ pressed }) => [styles.closeBtn, { backgroundColor: theme.bg2, borderColor: theme.line, opacity: pressed ? 0.85 : 1 }]}
        >
          <Icons.close size={18} color={theme.ink} />
        </Pressable>
        <Text style={[styles.changeCount, { color: theme.ink3 }]}>
          {changedCount > 0 ? `${changedCount} change${changedCount > 1 ? 's' : ''}` : 'No changes'}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: theme.ink3 }]}>RECONCILE</Text>
        <Text style={[styles.title, { color: theme.ink }]}>Stock-take</Text>
      </View>

      <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
        <Text style={[styles.desc, { color: theme.ink2 }]}>
          Count what's actually on your shelves. Anything you've used in bits gets reset to the true number.
        </Text>
      </View>

      {/* Category chips */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {cats.map((item, index) => (
            <View key={item} style={index < cats.length - 1 && { marginRight: 8 }}>
              <Chip active={cat === item} onPress={() => setCat(item)}>
                {item === 'all' ? 'All' : item}
              </Chip>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Product list */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={{ gap: 8 }}>
          {filtered.map((p) => (
            <StockTakeRow
              key={p.id}
              product={p}
              value={counts[p.id] ?? formatStockInput(p.stock)}
              onChange={(v) => setCounts((c) => ({ ...c, [p.id]: v }))}
              theme={theme}
            />
          ))}
        </View>
      </ScrollView>

      {/* Save button */}
      <View style={[styles.saveWrap, { borderTopColor: theme.line, backgroundColor: theme.bg }]}>
        <Pressable
          onPress={changedCount > 0 ? handleSave : undefined}
          style={[
            styles.saveBtn,
            { backgroundColor: changedCount > 0 ? theme.accent : theme.bg2 },
          ]}
        >
          <Icons.clipboardCheck size={16} color={changedCount > 0 ? '#fff' : theme.ink3} />
          <Text style={[styles.saveBtnText, { color: changedCount > 0 ? '#fff' : theme.ink3 }]}>
            {changedCount > 0 ? `Update ${changedCount} item${changedCount > 1 ? 's' : ''}` : 'No changes to save'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function StockTakeRow({
  product, value, onChange, theme,
}: {
  product: Product;
  value: string;
  onChange: (v: string) => void;
  theme: any;
}) {
  const counted = parseStockInput(value) ?? product.stock;
  const diff = counted - product.stock;
  const diffLabel = Math.abs(diff) < 0.001 ? null
    : `${diff > 0 ? '+' : ''}${formatStockInput(diff)}`;
  const step = (by: number) => onChange(formatStockInput(Math.max(0, counted + by)));
  const diffColor = diff > 0 ? theme.sage : diff < 0 ? theme.danger : theme.ink3;

  return (
    <View style={[styles.row, { backgroundColor: theme.card, borderColor: theme.line }]}>
      {/* Swatch */}
      <View style={[styles.swatch, { backgroundColor: theme.bg2 }]}>
        <Text style={[styles.swatchText, { color: theme.ink3 }]}>
          {product.brand.slice(0, 3).toUpperCase()}
        </Text>
      </View>
      {/* Info */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>{product.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.rowSub, { color: theme.ink2 }]}>System: {product.stock}</Text>
          {diffLabel && (
            <Text style={[styles.rowDiff, { color: diffColor }]}>{diffLabel}</Text>
          )}
        </View>
      </View>
      {/* Counter */}
      <View style={styles.counter}>
        <Pressable
          onPress={() => step(-1)}
          accessibilityRole="button"
          accessibilityLabel={`One less ${product.name}`}
          style={[styles.counterBtn, { borderColor: theme.line, backgroundColor: theme.bg2 }]}
        >
          <Text style={[styles.counterBtnText, { color: theme.ink2 }]}>−</Text>
        </Pressable>
        <TextInput
          style={[styles.counterInput, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.bg2 }]}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={(t) => onChange(sanitizeStockInput(t))}
          selectTextOnFocus
          accessibilityLabel={`${product.name} count`}
        />
        <Pressable
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel={`One more ${product.name}`}
          style={[styles.counterBtn, { borderColor: theme.line, backgroundColor: theme.bg2 }]}
        >
          <Text style={[styles.counterBtnText, { color: theme.ink2 }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeCount: { fontSize: 11, letterSpacing: 1, fontWeight: '500' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '400', marginBottom: 4 },
  title: { fontSize: 28, fontFamily: SERIF, letterSpacing: -0.5 },
  desc: { fontSize: 13, lineHeight: 19 },
  chipRow: { paddingHorizontal: 20, paddingBottom: 14 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 0.5,
  },
  swatch: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  swatchText: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  rowName: { fontSize: 13, fontWeight: '600' },
  rowSub: { fontSize: 11 },
  rowDiff: { fontSize: 11, fontWeight: '700' },

  counter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  counterBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: { fontSize: 16, fontWeight: '500', lineHeight: 20 },
  counterInput: {
    width: 48,
    paddingVertical: 6,
    textAlign: 'center',
    borderWidth: 0.5,
    borderRadius: 8,
    fontSize: 16,
    fontWeight: '500',
  },

  saveWrap: {
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 0.5,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 16,
  },
  saveBtnText: { fontSize: 15, fontWeight: '600' },
});
