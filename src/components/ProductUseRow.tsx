import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { Product } from '../data/types';
import { Icons } from './Icons';

interface Props {
  product: Product;
  amount: number;
  editable: boolean;
  onChangeAmount: (a: number) => void;
  onRemove: () => void;
}

/** A product usage line: swatch, name, and (when editable) a −/+ stepper with direct entry. */
export function ProductUseRow({ product, amount, editable, onChangeAmount, onRemove }: Props) {
  const { theme } = useApp();
  return (
    <View style={[styles.row, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={[styles.swatch, { backgroundColor: theme.bg2 }]}>
        <Text style={[styles.swatchText, { color: theme.ink3 }]}>
          {product.brand.slice(0, 3).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.name, { color: theme.ink }]} numberOfLines={1}>{product.name}</Text>
        <Text style={[styles.brand, { color: theme.ink2 }]}>{product.brand}</Text>
      </View>
      {editable ? (
        <View style={styles.amtControl}>
          <Pressable
            onPress={() => onChangeAmount(Math.max(0, amount - 5))}
            hitSlop={8}
            style={({ pressed }) => [styles.amtBtn, { borderColor: theme.line, backgroundColor: theme.bg2, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.amtBtnText, { color: theme.ink2 }]}>−</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 48 }}>
            <TextInput
              style={[styles.amtText, { color: theme.ink, padding: 0, minWidth: 0 }]}
              value={amount.toString()}
              onChangeText={(t) => {
                const n = parseFloat(t);
                onChangeAmount(isNaN(n) ? 0 : n);
              }}
              keyboardType="numeric"
            />
            <Text style={[styles.amtText, { color: theme.ink, padding: 0, minWidth: 0 }]}>{product.unit}</Text>
          </View>
          <Pressable
            onPress={() => onChangeAmount(amount + 5)}
            hitSlop={8}
            style={({ pressed }) => [styles.amtBtn, { borderColor: theme.line, backgroundColor: theme.bg2, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.amtBtnText, { color: theme.ink2 }]}>+</Text>
          </Pressable>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => [{ padding: 4, marginLeft: 2, opacity: pressed ? 0.5 : 1 }]}
          >
            <Icons.close size={14} color={theme.ink3} />
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.amtText, { color: theme.ink }]}>{amount}{product.unit}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  swatchText: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  name: { fontSize: 13, fontWeight: '600' },
  brand: { fontSize: 11, marginTop: 1 },
  amtControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amtBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amtBtnText: { fontSize: 20, fontWeight: '500', lineHeight: 24 },
  amtText: { fontSize: 13, fontWeight: '600', minWidth: 48, textAlign: 'center' },
});
