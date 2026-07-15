import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { is24Hour } from '../data/utils';

interface Props {
  value: { h: number; m: number };
  onChange: (t: { h: number; m: number }) => void;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6am–10pm
const MINUTES = [0, 15, 30, 45];

/** Hour + minute chip rows for picking an off-grid appointment time. */
export function CustomTimeRow({ value, onChange }: Props) {
  const { theme } = useApp();
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {HOURS.map((h) => {
          const active = value.h === h;
          return (
            <Pressable
              key={h}
              onPress={() => onChange({ h, m: value.m })}
              style={[styles.chip, { backgroundColor: active ? theme.accent : theme.bg2 }]}
            >
              <Text style={[styles.chipText, { color: active ? '#fff' : theme.ink2 }]}>
                {is24Hour() ? h.toString().padStart(2, '0') : `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.row}>
        {MINUTES.map((m) => {
          const active = value.m === m;
          return (
            <Pressable
              key={m}
              onPress={() => onChange({ h: value.h, m })}
              style={[styles.chip, { backgroundColor: active ? theme.accent : theme.bg2 }]}
            >
              <Text style={[styles.chipText, { color: active ? '#fff' : theme.ink2 }]}>
                :{m.toString().padStart(2, '0')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 12 },
  row: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '600' },
});
