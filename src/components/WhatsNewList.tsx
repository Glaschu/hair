import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../data/AppContext';
import { Icons } from './Icons';

const PLUM = '#8a3ab9';

interface Entry {
  icon: keyof typeof Icons;
  tint: 'accent' | 'sage' | 'plum';
  title: string;
  body: string;
}

// The current release's headline features — shown in the What's New sheet
// on both the phone and iPad Settings screens. Update per release.
const ENTRIES: Entry[] = [
  {
    icon: 'scissors',
    tint: 'accent',
    title: 'The chair-side view',
    body: 'Today now shows everything about the client in the chair — allergies, their working formula, the plan from their last visit, and their photo gallery. On iPad it lives in a full side panel next to your schedule.',
  },
  {
    icon: 'clipboardCheck',
    tint: 'sage',
    title: 'Visit records',
    body: 'After an appointment, tap "Add visit notes" to record the full visit — formula, technique, processing time, notes, and before & after photos. Adjusting products afterwards keeps your stock accurate.',
  },
  {
    icon: 'calendar',
    tint: 'plum',
    title: 'Next-time plans',
    body: "Write the plan for a client's next visit while it's fresh. It appears chair-side automatically the moment they're back in your book.",
  },
];

/** The entry rows inside the What's New sheet — one source for both form factors. */
export function WhatsNewList() {
  const { theme } = useApp();
  const tints = { accent: theme.accent, sage: theme.sage, plum: PLUM } as const;

  return (
    <>
      {ENTRIES.map((e) => {
        const Icon = Icons[e.icon];
        const tint = tints[e.tint];
        return (
          <View key={e.title} style={styles.row}>
            <View style={[styles.icon, { backgroundColor: tint + '20' }]}>
              <Icon size={18} color={tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.ink }]}>{e.title}</Text>
              <Text style={[styles.body, { color: theme.ink2 }]}>{e.body}</Text>
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 24, flexDirection: 'row', gap: 16 },
  icon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 13, marginTop: 4, lineHeight: 18 },
});
