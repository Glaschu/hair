import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn, useLocalDialog } from '../components';
import { loadCredentials, clearCredentials } from '../data/bookingStore';
import { firebaseAuthSdk } from '../data/auth/firebaseSdk';
import { probeAccess } from '../data/firestoreDb';
import { fetchSalon, registerSalon, SalonAlreadySetUpError } from '../data/bookingApi';
import {
  signIn, signOut, checkAdmitted, loadSession, stateOf, waitingCopy, NoAccountError,
  type AuthState,
} from '../data/auth';
import type { FirebaseConfig } from '../data/bookingLink';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Getting this device into her database.
 *
 * Only reachable on a deployment that keeps its data in Firestore — the
 * Cloudflare version never comes here, because there is nothing to sign in to.
 *
 * The screen is really about one awkward state: signed in, but not yet allowed
 * in. That is where every self-hosted first run lands, and it is not an error —
 * so it reads as a step with something to do, not as a failure.
 */
export default function CloudAccessScreen() {
  const { theme, studioName, resendDaysOff, refreshBackend } = useApp();
  const { alert, confirm, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();

  const [config, setConfig] = useState<FirebaseConfig | null>(null);
  const [state, setState] = useState<AuthState>({ kind: 'signed-out' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const creds = await loadCredentials().catch(() => null);
      setConfig(creds?.firebase ?? null);
      setState(stateOf(await loadSession()));
      setLoading(false);
    })();
  }, []);

  const inputStyle = [styles.input, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }];

  const doSignIn = async () => {
    if (!config || !email.trim() || !password) return;
    setBusy(true);
    try {
      let session;
      try {
        session = await signIn(firebaseAuthSdk(config), email, password);
      } catch (e) {
        if (!(e instanceof NoAccountError)) throw e;
        const make = await confirm({
          title: "Couldn't sign in",
          message:
            `Either the password is wrong, or there's no account for ${e.email} yet. ` +
            'Check the email carefully — only create an account if this is your first time signing in.',
          confirmLabel: 'Create account',
          cancelLabel: 'Try again',
        });
        if (!make) return;
        session = await signIn(firebaseAuthSdk(config), email, password, { create: true });
      }
      setState(stateOf(session));
      // Straight into the check: her uid may already be on the allowlist if she
      // is adding a second device, and making her tap again would be silly.
      await recheck(false);
    } catch (e) {
      await alert({
        title: "Couldn't sign in",
        message: e instanceof Error ? e.message : 'Check the address and password and try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Once she is in, make sure the service knows her salon.
   *
   * On this deployment the salon can only be registered by someone the
   * service has let in, so it happens here rather than at scan time. A second
   * device carries the same keys and finds them already registered — nothing
   * to do. A DIFFERENT key means this phone was set up fresh against a service
   * that already has a salon, and every booking sealed to the old key would be
   * unreadable here, so she is asked, exactly as on the Cloudflare version.
   */
  const ensureSalon = async () => {
    const creds = await loadCredentials();
    if (!creds?.firebase) return;
    const existing = await fetchSalon(creds);
    if (!existing) {
      await registerSalon(creds, studioName);
      await resendDaysOff().catch(() => {});
      return;
    }
    if (existing.publicKey === creds.keyPair.publicKey) return;

    const ok = await confirm({
      title: 'Already set up',
      message:
        `${existing.name} is already using this service. Setting up again makes new keys, so ` +
        "any booking that hasn't reached the app yet can't be opened — appointments already " +
        'in your book are safe. To add a device instead, scan the code from inside the app ' +
        'on the one that already works.',
      confirmLabel: 'Start again anyway',
      tone: 'destructive',
    });
    if (!ok) {
      // Staying linked with keys that don't match the salon is the worst of
      // both: every booking arrives unreadable here. So this device is
      // unlinked, ready to be paired properly from the one that works.
      await signOut(firebaseAuthSdk(creds.firebase)).catch(() => {});
      await clearCredentials();
      await refreshBackend();
      setConfig(null);
      setState({ kind: 'signed-out' });
      await alert({
        title: 'Not linked',
        message: 'To add this device, open the app on the one that already works, go to Settings → Online booking → Show code, and scan that code here.',
      });
      nav.goBack();
      return;
    }
    try {
      // The service only honours this alongside a sign-in from the last few
      // minutes — a stolen token is not enough to redirect her bookings.
      await registerSalon(creds, studioName, 'confirm');
      await resendDaysOff().catch(() => {});
    } catch (e) {
      if (!(e instanceof SalonAlreadySetUpError)) throw e;
      await alert({
        title: 'Sign in again to start over',
        message: 'For safety, starting over needs a fresh sign-in. Sign out, sign back in, and try again.',
      });
    }
  };

  const recheck = async (announce = true) => {
    if (!config) return;
    setBusy(true);
    try {
      // The probe is a real read of what she needs, from the server. It answers
      // yes or no, and throws when it cannot tell — which is said as such, not
      // as "you're not on the list".
      const admitted = await checkAdmitted(firebaseAuthSdk(config), () => probeAccess(config));
      setState(stateOf(await loadSession()));
      if (admitted) {
        await ensureSalon();
        // What the service can do (deposits or not) is only knowable once in.
        await refreshBackend();
      } else if (announce) {
        await alert({
          title: 'Not yet',
          message: "This device still isn't on the list. Add the ID above, then try again.",
        });
      }
    } catch (e) {
      await alert({
        title: "Couldn't reach your database",
        message: e instanceof Error && e.name === 'NotSignedInError'
          ? e.message
          : 'Check your connection and try again. Nothing has changed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const doSignOut = async () => {
    if (!config) return;
    await signOut(firebaseAuthSdk(config));
    setState({ kind: 'signed-out' });
  };

  const header = (
    <View style={styles.header}>
      <RoundBtn onPress={() => nav.goBack()}><Icons.chevronLeft size={20} color={theme.ink} /></RoundBtn>
      <Text style={[styles.headerTitle, { color: theme.ink }]}>Your database</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
        {header}
        <View style={styles.centre}><ActivityIndicator color={theme.accent} /></View>
      </SafeAreaView>
    );
  }

  // No Firestore on this deployment. Said plainly rather than shown as a broken
  // sign-in form.
  if (!config) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={[styles.title, { color: theme.ink }]}>Nothing to sign in to</Text>
          <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
            Your booking service keeps its own data, so there's no separate database to join.
            Everything stays on this phone and in iCloud.
          </Text>
        </ScrollView>
        {dialog}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 20 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {state.kind === 'signed-out' && (
          <>
            <Text style={[styles.title, { color: theme.ink }]}>Sign in</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
              This is your own database — nobody else can reach it. If you haven't used it
              before, signing in creates your account.
            </Text>
            <View style={{ gap: 14 }}>
              <View style={{ gap: 7 }}>
                <Text style={[styles.label, { color: theme.ink3 }]}>EMAIL</Text>
                <TextInput
                  style={inputStyle} value={email} onChangeText={setEmail}
                  placeholder="you@yoursalon.co.uk" placeholderTextColor={theme.ink3}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                />
              </View>
              <View style={{ gap: 7 }}>
                <Text style={[styles.label, { color: theme.ink3 }]}>PASSWORD</Text>
                <TextInput
                  style={inputStyle} value={password} onChangeText={setPassword}
                  placeholder="At least six characters" placeholderTextColor={theme.ink3}
                  autoCapitalize="none" autoCorrect={false} secureTextEntry
                />
              </View>
            </View>
            <Pressable
              onPress={doSignIn} disabled={busy}
              style={[styles.primary, { backgroundColor: busy ? theme.bg2 : theme.heroBg }]}
            >
              {busy ? <ActivityIndicator color={theme.ink2} />
                    : <Text style={styles.primaryText}>Sign in</Text>}
            </Pressable>
          </>
        )}

        {state.kind === 'waiting-for-access' && (
          <>
            <Text style={[styles.title, { color: theme.ink }]}>{waitingCopy(state.uid).title}</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
              {waitingCopy(state.uid).body}
            </Text>

            {/* Her ID is a thing to copy, not an error code — so it is big,
                selectable, and has a share button next to it. */}
            <View style={[styles.idCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <Text style={[styles.label, { color: theme.ink3 }]}>THIS DEVICE'S ID</Text>
              <Text selectable style={[styles.uid, { color: theme.ink }]}>{state.uid}</Text>
              <Pressable
                onPress={() => Share.share({ message: state.uid })}
                style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }}>Share this ID</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => recheck()} disabled={busy}
              style={[styles.primary, { backgroundColor: busy ? theme.bg2 : theme.heroBg }]}
            >
              {busy ? <ActivityIndicator color={theme.ink2} />
                    : <Text style={styles.primaryText}>Check again</Text>}
            </Pressable>
            <Pressable onPress={doSignOut} style={{ alignSelf: 'center', padding: 8 }}>
              <Text style={{ fontSize: 13, color: theme.ink3 }}>Sign out</Text>
            </Pressable>
          </>
        )}

        {state.kind === 'ready' && (
          <>
            <Text style={[styles.title, { color: theme.ink }]}>Connected</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
              Signed in as {state.email}. Bookings clients make online arrive in your diary when
              you pull down on Today — their details are sealed so only your devices can read them.
            </Text>
            <Pressable onPress={doSignOut} style={{ alignSelf: 'center', padding: 8 }}>
              <Text style={{ fontSize: 13, color: theme.ink3 }}>Sign out</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
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
  title: { fontSize: 30, fontFamily: SERIF, letterSpacing: -0.4 },
  label: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  input: {
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 16,
    minHeight: 52, fontSize: 16,
  },
  primary: {
    minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  idCard: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 8 },
  uid: { fontSize: 15, fontFamily: 'Menlo', letterSpacing: -0.2 },
});
