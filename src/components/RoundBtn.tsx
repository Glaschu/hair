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
}

export function RoundBtn({ onPress, children, size = 38, filled = false, style }: Props) {
  const { theme } = useApp();

  const handlePress = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
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
