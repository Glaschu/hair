import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn, useLocalDialog } from '../components';
import { loadCredentials } from '../data/bookingStore';
import { fetchSalon, savePolicy, DEFAULT_CANCELLATION_POLICY } from '../data/bookingApi';
import { describeTiers, formFromTiers, tiersFromForm, validTiers } from '../data/policy';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FULL_HOURS = [24, 48, 72, 168];
const PARTIAL_PCT = [0, 25, 50, 75];
const PARTIAL_HOURS = [12, 24, 48, 72];

const hoursChip = (h: number) => (h === 168 ? '1 week' : h >= 72 ? `${h / 24} days` : `${h} hours`);

function Chips({ options, value, label, onChange }: {
  options: number[]; value: number; label: (v: number) => string; onChange: (v: number) => void;
}) {
  const { theme } = useApp();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, {
              backgroundColor: on ? theme.accent + '18' : theme.card,
              borderColor: on ? theme.accent : theme.line,
            }]}
          >
            <Text style={{ fontSize: 14, fontWeight: on ? '700' : '500', color: on ? theme.accent : theme.ink2 }}>
              {label(o)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Her cancellation policy: the words clients agree to before booking, and —
 * where she takes deposits — how much of the deposit comes back at each
 * notice.
 *
 * The numbers are chosen, not typed, and clients are shown them as plain lines
 * under her words: the schedule the service refunds by is always part of what
 * they agreed to, even if her wording says something slightly different.
 * Saving changes links made from now on; links already sent keep the terms
 * they went out with, because that is what those clients were shown.
 */
export default function CancellationPolicyScreen() {
  const { theme, backend } = useApp();
  const { alert, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const deposits = backend.has('deposits');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState('');
  const [form, setForm] = useState(formFromTiers(null));
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const creds = await loadCredentials();
        if (!creds) { setProblem('Set up your booking service first — Settings → Online booking.'); return; }
        const salon = await fetchSalon(creds);
        if (!salon) { setProblem('Finish setting up your booking service first, then come back here.'); return; }
        setText(salon.policy ?? DEFAULT_CANCELLATION_POLICY);
        setForm(formFromTiers(salon.tiers));
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "Couldn't reach your booking service.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tiers = useMemo(() => tiersFromForm(form), [form]);
  const preview = useMemo(() => describeTiers(tiers), [tiers]);

  const save = async () => {
    if (!text.trim()) {
      await alert({ title: 'Add your policy', message: 'Clients have to agree to something — write a line or two.' });
      return;
    }
    if (deposits && !validTiers(tiers)) {
      await alert({ title: "That schedule doesn't add up", message: 'More notice should never mean less back.' });
      return;
    }
    setSaving(true);
    try {
      const creds = await loadCredentials();
      if (!creds) throw new Error('Set up your booking service first.');
      await savePolicy(creds, { policy: text.trim(), tiers: deposits ? tiers : undefined });
      await alert({
        title: 'Saved',
        message: 'Links you send from now on use these terms. Links already sent keep the terms they went out with.',
      });
      nav.goBack();
    } catch (e) {
      await alert({
        title: "Couldn't save",
        message: e instanceof Error ? e.message : 'Check your connection and try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.header}>
        <RoundBtn label="Back" onPress={() => nav.goBack()}><Icons.chevronLeft size={20} color={theme.ink} /></RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>Cancellation policy</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator color={theme.accent} /></View>
      ) : problem ? (
        <View style={{ padding: 20 }}>
          <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>{problem}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: theme.ink3 }]}>WHAT CLIENTS READ</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              style={[styles.input, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }]}
            />
            <Text style={{ fontSize: 13, color: theme.ink3 }}>
              Clients tick to agree to this before they can book.
            </Text>
          </View>

          {deposits && (
            <View style={{ gap: 14 }}>
              <Text style={[styles.label, { color: theme.ink3 }]}>THE DEPOSIT, IF THEY CANCEL</Text>

              <View style={{ gap: 8 }}>
                <Text style={[styles.question, { color: theme.ink }]}>All of it back with at least</Text>
                <Chips
                  options={FULL_HOURS}
                  value={form.fullHours}
                  label={hoursChip}
                  onChange={(fullHours) => setForm((f) => ({
                    ...f, fullHours,
                    // Keep the partial window inside the full one.
                    partialHours: f.partialHours < fullHours ? f.partialHours : PARTIAL_HOURS.filter((h) => h < fullHours).pop() ?? 0,
                  }))}
                />
              </View>

              <View style={{ gap: 8 }}>
                <Text style={[styles.question, { color: theme.ink }]}>With less notice than that</Text>
                <Chips
                  options={PARTIAL_PCT}
                  value={form.partialPct}
                  label={(p) => (p === 0 ? 'Nothing back' : `${p}% back`)}
                  onChange={(partialPct) => setForm((f) => ({ ...f, partialPct }))}
                />
              </View>

              {form.partialPct > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={[styles.question, { color: theme.ink }]}>…as long as they give at least</Text>
                  <Chips
                    options={PARTIAL_HOURS.filter((h) => h < form.fullHours)}
                    value={form.partialHours}
                    label={hoursChip}
                    onChange={(partialHours) => setForm((f) => ({ ...f, partialHours }))}
                  />
                </View>
              )}

              <View style={[styles.previewBox, { backgroundColor: theme.bg2 }]}>
                <Text style={[styles.label, { color: theme.ink3 }]}>CLIENTS ALSO SEE</Text>
                {preview.map((line) => (
                  <Text key={line} style={{ fontSize: 14, lineHeight: 20, color: theme.ink }}>• {line}</Text>
                ))}
                <Text style={{ fontSize: 12, lineHeight: 17, color: theme.ink3, marginTop: 4 }}>
                  These are the amounts refunds are actually worked out from. If your wording says
                  something different, change one so they match.
                </Text>
              </View>
            </View>
          )}

          <Text style={{ fontSize: 13, lineHeight: 18, color: theme.ink3 }}>
            Links you send from now on use these terms. Links already sent keep the terms they
            went out with — that's what those clients were shown.
          </Text>

          <Pressable
            onPress={save}
            disabled={saving}
            style={[styles.primary, { backgroundColor: saving ? theme.bg2 : theme.heroBg }]}
          >
            {saving ? <ActivityIndicator color={theme.ink2} /> : <Text style={styles.primaryText}>Save policy</Text>}
          </Pressable>
        </ScrollView>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerTitle: { fontSize: 17, fontFamily: SERIF },
  label: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  question: { fontSize: 15, fontWeight: '500' },
  input: {
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    minHeight: 180, fontSize: 15, lineHeight: 21,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  previewBox: { borderRadius: 14, padding: 14, gap: 6 },
  primary: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
