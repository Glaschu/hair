import React from 'react';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useApp } from '../data/AppContext';

interface Props {
  onPress?: () => void;
  children: React.ReactNode;
  size?: number;
  filled?: boolean;
  style?: ViewStyle;
  /** Spoken name for this icon-only button (VoiceOver / TalkBack). */
  label?: string;
}

export function RoundBtn({ onPress, children, size = 38, filled = false, style, label }: Props) {
  const { theme } = useApp();

  const handlePress = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={size < 40 ? 6 : 0}
      style={({ pressed }) => [
        styles.btn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: filled ? theme.ink : theme.card,
          borderColor: theme.line,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
