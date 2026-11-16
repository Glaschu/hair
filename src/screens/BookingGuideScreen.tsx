import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn } from '../components';
import { BOOKING_GUIDE } from '../data/bookingGuide';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * How online booking is set up and used — the page she can come back to.
 *
 * Setup is spread over three screens and a web page, and nothing said what
 * order they go in. Read-only on purpose: every step names the button to
 * press, on the screen where it lives.
 */
export default function BookingGuideScreen() {
  const { theme } = useApp();
  const nav = useNavigation<Nav>();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.header}>
        <RoundBtn label="Back" onPress={() => nav.goBack()}><Icons.chevronLeft size={20} color={theme.ink} /></RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>How online booking works</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 26, paddingBottom: 48 }}>
        <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
          You send a client a link, they pick a time, and it lands in your diary. Setting it up takes
          about ten minutes, once.
        </Text>

        {BOOKING_GUIDE.map((section) => {
          // Numbered only where the order matters: setup is a sequence, the rest is reference.
          const ordered = section === BOOKING_GUIDE[0];
          return (
            <View key={section.heading} style={{ gap: 10 }}>
              <Text style={[styles.eyebrow, { color: theme.ink3 }]}>{section.heading.toUpperCase()}</Text>
              <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
                {section.steps.map((step, i) => (
                  <View key={step.title}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
                    <View style={styles.step}>
                      {ordered && (
                        <View style={[styles.num, { backgroundColor: theme.accent + '18' }]}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }}>{i + 1}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.stepTitle, { color: theme.ink }]}>{step.title}</Text>
                        <Text style={[styles.stepBody, { color: theme.ink2 }]}>{step.body}</Text>
                        {step.note && <Text style={[styles.stepNote, { color: theme.ink3 }]}>{step.note}</Text>}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerTitle: { fontSize: 17, fontFamily: SERIF },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  card: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 },
  divider: { height: StyleSheet.hairlineWidth },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 14 },
  num: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepTitle: { fontSize: 15, fontWeight: '600' },
  stepBody: { fontSize: 14, lineHeight: 20 },
  stepNote: { fontSize: 12.5, lineHeight: 17, fontStyle: 'italic' },
});
