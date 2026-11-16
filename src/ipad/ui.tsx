import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { useApp } from '../data/AppContext';
import { SERIF } from '../theme';

/** Uppercase tracked label used above headings throughout the iPad layouts. */
export function Eyebrow({ children, color, style }: { children: React.ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  const { theme } = useApp();
  return <Text style={[styles.eyebrow, { color: color ?? theme.ink3 }, style]}>{children}</Text>;
}

/** Italic display heading — matches the app's serif-style titles. */
export function Title({ children, size = 30, color, style }: { children: React.ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const { theme } = useApp();
  return (
    <Text style={[styles.title, { fontSize: size, lineHeight: size * 1.12, color: color ?? theme.ink }, style]}>
      {children}
    </Text>
  );
}

type BtnVariant = 'default' | 'primary' | 'dark' | 'soft';

export function Btn({
  children, onPress, variant = 'default', icon, style, textColor, compact, disabled,
}: {
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: BtnVariant;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textColor?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useApp();
  const bg =
    variant === 'primary' ? theme.accent
    : variant === 'dark' ? theme.heroBg
    : variant === 'soft' ? theme.bg2
    : theme.card;
  const fg = textColor ?? (variant === 'primary' || variant === 'dark' ? '#fff' : theme.ink);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.btn,
        compact && { paddingVertical: 8, paddingHorizontal: 14 },
        { backgroundColor: bg, borderColor: variant === 'default' ? theme.line : 'transparent', opacity: pressed ? 0.85 : disabled ? 0.5 : 1 },
        style,
      ]}
    >
      {icon}
      {children != null && (
        <Text style={[styles.btnText, { color: fg, fontSize: compact ? 12 : 14 }]}>{children}</Text>
      )}
    </Pressable>
  );
}

/** Compact label + value tile. `dark` variant sits on the hero card. */
export function StatTile({
  label, value, sub, dark, valueColor, style,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  dark?: boolean;
  valueColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useApp();
  const labelColor = dark ? 'rgba(255,255,255,0.5)' : theme.ink3;
  const subColor = dark ? 'rgba(255,255,255,0.55)' : theme.ink2;
  const isText = typeof value === 'string' || typeof value === 'number';
  return (
    <View style={[
      styles.statTile,
      { backgroundColor: dark ? 'rgba(255,255,255,0.07)' : theme.card, borderColor: dark ? 'transparent' : theme.line },
      style,
    ]}>
      <Text style={[styles.statLabel, { color: labelColor }]}>{label.toUpperCase()}</Text>
      {isText
        ? <Text style={[styles.statValue, { color: valueColor ?? (dark ? '#fff' : theme.ink) }]}>{value}</Text>
        : <View style={styles.statValueNode}>{value}</View>}
      {sub && <Text style={[styles.statSub, { color: subColor }]}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600' },
  title: { fontFamily: SERIF, letterSpacing: -0.4 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 0.5,
  },
  btnText: { fontWeight: '500' },
  statTile: { flex: 1, borderRadius: 14, borderWidth: 0.5, paddingVertical: 14, paddingHorizontal: 16, minWidth: 0 },
  statLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '500' },
  statValue: { fontFamily: SERIF, fontSize: 26, lineHeight: 30, letterSpacing: -0.4, marginTop: 5 },
  statValueNode: { marginTop: 6, height: 30, justifyContent: 'center' },
  statSub: { fontSize: 12, marginTop: 6 },
});
