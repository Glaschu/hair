import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Platform,
  KeyboardAvoidingView, ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Card, Icons, RoundBtn, useLocalDialog } from '../components';
import {
  BookingCredentials, decodeScannedCode, encodePairing, isUsableServiceUrl,
  newCredentials, describeService, type FirebaseConfig,
} from '../data/bookingLink';
import { loadCredentials, saveCredentials, clearCredentials } from '../data/bookingStore';
import { firebaseAuthSdk } from '../data/auth/firebaseSdk';
import { signOut } from '../data/auth';
import { registerSalon, checkService, fetchSalon } from '../data/bookingApi';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Mode = 'loading' | 'linked' | 'setup' | 'scanning' | 'showing';

export default function BookingSetupScreen() {
  const { theme, studioName, resendDaysOff, refreshBackend } = useApp();
  const { confirm, alert, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();

  const [mode, setMode] = useState<Mode>('loading');
  const [creds, setCreds] = useState<BookingCredentials | null>(null);
  const [url, setUrl] = useState('');
  const [deviceKey, setDeviceKey] = useState('');
  /**
   * A pasted code. A phone cannot scan its own screen, so if she opens the
   * setup page on the phone she is setting up, copying the code across is the
   * only way in — and a simulator has no camera at all.
   */
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadCredentials().then((saved) => {
      setCreds(saved);
      setMode(saved ? 'linked' : 'setup');
    });
  }, []);

  const link = async (next: BookingCredentials, announce: boolean) => {
    setBusy(true);
    try {
      // Ask what the service is before handing it anything.
      await checkService(next.serviceUrl);
      if (next.firebase) {
        // On the Firebase deployment there is no device key to prove anything
        // with: she signs in, and is let in by the allowlist. Registering the
        // salon waits until then — the service would refuse it now — and
        // happens on the sign-in screen once this device is admitted.
        await saveCredentials(next);
        // Settings and the Send link button read the link from here; without
        // this they kept saying "not set up" (or "linked") until the app restarted.
        await refreshBackend();
        setCreds(next);
        setMode('linked');
        nav.navigate('CloudAccess');
        return;
      }
      // Registering proves the key works before we call this device linked.
      if (announce) await registerSalon(next, studioName);
      await saveCredentials(next);
        // Settings and the Send link button read the link from here; without
        // this they kept saying "not set up" (or "linked") until the app restarted.
        await refreshBackend();
      await resendDaysOff().catch(() => {});
      setCreds(next);
      setMode('linked');
    } catch (e) {
      await alert({
        title: "Couldn't link this device",
        message: e instanceof Error ? e.message : 'Check the address and key and try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * A setup code makes fresh salon keys. If this service already has a
   * salon, doing that would strand every booking sealed to the old key —
   * so she gets asked first.
   */
  const linkAsFirstDevice = async (serviceUrl: string, deviceKey: string, firebase?: FirebaseConfig) => {
    const fresh = newCredentials(serviceUrl, deviceKey, firebase);
    // Firebase: whether this service already has a salon can only be asked once
    // she is signed in, so that question moves to the sign-in screen.
    if (fresh.firebase) { await link(fresh, true); return; }
    try {
      await checkService(fresh.serviceUrl);
      const existing = await fetchSalon(fresh);
      if (existing) {
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
          setMode('setup');
          return;
        }
      }
    } catch (e) {
      setMode('setup');
      await alert({
        title: "Couldn't link this device",
        message: e instanceof Error ? e.message : 'Check the service and try again.',
      });
      return;
    }
    await link(fresh, true);
  };

  const linkByTyping = () => {
    linkByTypingOrThrow().catch(async (e) => {
      await alert({
        title: "Couldn't link this device",
        message: e instanceof Error ? e.message : 'Something went wrong. Try again.',
      });
    });
  };

  const linkByTypingOrThrow = async () => {
    if (!isUsableServiceUrl(url)) {
      alert({ title: 'Check the address', message: 'It needs to start with https:// — your key is never sent over an unencrypted link.' });
      return;
    }
    if (!deviceKey.trim()) {
      alert({ title: 'Key missing', message: "Paste the device key from your service's setup page." });
      return;
    }
    link(newCredentials(url, deviceKey), true);
  };

  /**
   * A setup or pairing code, however it arrived — scanned, or pasted. One path,
   * so the two can never behave differently.
   */
  const applyCode = async (value: string) => {
    try {
      await applyCodeOrThrow(value);
    } catch (e) {
      // Never silent. A button that does nothing is how this screen hid, for
      // months, that it could not make keys on a phone at all.
      setMode('setup');
      await alert({
        title: "Couldn't link this device",
        message: e instanceof Error ? e.message : 'Something went wrong. Try again.',
      });
    }
  };

  const applyCodeOrThrow = async (value: string) => {
    const scanned = decodeScannedCode(value.trim());
    if (!scanned) {
      setMode('setup');
      await alert({
        title: 'Not a booking code',
        message: "That isn't a code from your booking service or another linked device.",
      });
      return;
    }
    if (scanned.kind === 'pairing') {
      // The other device already registered the salon — this one just joins.
      await link(scanned.credentials, false);
    } else {
      await linkAsFirstDevice(scanned.serviceUrl, scanned.deviceKey, scanned.firebase);
    }
  };

  const onScan = async (value: string) => {
    if (mode !== 'scanning' || busy) return;
    await applyCode(value);
  };

  const unlink = async () => {
    const ok = await confirm({
      title: 'Unlink this device?',
      message: 'It will stop receiving bookings. Your appointments and clients stay exactly as they are.',
      confirmLabel: 'Unlink',
      tone: 'destructive',
    });
    if (!ok) return;
    // Signed out of her database too: an unlinked device that can still read
    // it is not unlinked.
    if (creds?.firebase) await signOut(firebaseAuthSdk(creds.firebase)).catch(() => {});
    await clearCredentials();
    await refreshBackend();
    setCreds(null);
    setUrl('');
    setDeviceKey('');
    setMode('setup');
  };

  const startScanning = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        await alert({ title: 'Camera needed', message: 'Allow camera access to scan the code on your other device.' });
        return;
      }
    }
    setMode('scanning');
  };

  const header = (title: string, onBack: () => void) => (
    <View style={styles.header}>
      <RoundBtn label="Back" onPress={onBack} size={38}>
        <Icons.chevronLeft size={18} color={theme.ink} />
      </RoundBtn>
      <Text style={[styles.headerTitle, { color: theme.ink }]}>{title}</Text>
      <View style={{ width: 38 }} />
    </View>
  );

  // ---------- scanning ----------
  if (mode === 'scanning') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScan(data)}
        />
        <SafeAreaView style={{ flex: 1, justifyContent: 'space-between' }} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <RoundBtn label="Cancel" onPress={() => setMode('setup')} size={38}>
              <Icons.close size={18} color={theme.ink} />
            </RoundBtn>
            <View style={{ flex: 1 }} />
          </View>
          <View style={styles.scanHint}>
            <Text style={styles.scanHintText}>
              Point at the code on your setup page or other device
            </Text>
          </View>
        </SafeAreaView>
        {dialog}
      </View>
    );
  }

  // ---------- showing the pairing code ----------
  if (mode === 'showing' && creds) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
        {header('Link another device', () => setMode('linked'))}
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20, alignItems: 'center' }}>
          <View style={[styles.qrWrap, { backgroundColor: '#FFFFFF' }]}>
            <QRCode value={encodePairing(creds)} size={236} backgroundColor="#FFFFFF" color="#2A201A" />
          </View>
          <Text style={[styles.qrCaption, { color: theme.ink2 }]}>
            On your other device, open Settings → Online booking → Scan a code.
          </Text>
          <Card style={{ padding: 16, width: '100%' }}>
            <View style={{ flexDirection: 'row', gap: 11 }}>
              <Icons.alert size={17} color={theme.warn} />
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, color: theme.ink2 }}>
                <Text style={{ fontWeight: '600', color: theme.ink }}>Keep this on your own screen. </Text>
                Anyone who photographs this code can read your bookings. Close it when you're done.
              </Text>
            </View>
          </Card>
        </ScrollView>
        {dialog}
      </SafeAreaView>
    );
  }

  // ---------- linked ----------
  if (mode === 'linked' && creds) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
        {header('Online booking', () => nav.goBack())}
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Card style={{ padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.tick, { backgroundColor: theme.sage + '25' }]}>
                <Icons.check size={18} color={theme.sage} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15.5, fontWeight: '600', color: theme.ink }}>This device is linked</Text>
                <Text style={{ fontSize: 13, color: theme.ink2, marginTop: 2 }}>{describeService(creds)}</Text>
              </View>
            </View>
          </Card>

          <Pressable onPress={() => setMode('showing')} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={[styles.rowIcon, { backgroundColor: theme.accent + '18' }]}>
              <Icons.barcode size={16} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: theme.ink }]}>Link another device</Text>
              <Text style={[styles.rowSub, { color: theme.ink3 }]}>Show a code for your iPad to scan</Text>
            </View>
            <Icons.chevronRight size={16} color={theme.ink3} />
          </Pressable>

          <Pressable onPress={unlink} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={[styles.rowIcon, { backgroundColor: theme.danger + '18' }]}>
              <Icons.close size={16} color={theme.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: theme.danger }]}>Unlink this device</Text>
              <Text style={[styles.rowSub, { color: theme.ink3 }]}>Stops bookings arriving here</Text>
            </View>
          </Pressable>
        </ScrollView>
        {dialog}
      </SafeAreaView>
    );
  }

  // ---------- setup ----------
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
        {header('Online booking', () => nav.goBack())}
        {mode === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 22 }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 8 }}>
              <Text style={[styles.title, { color: theme.ink }]}>Link this device</Text>
              <Text style={{ fontSize: 15, lineHeight: 21, color: theme.ink2 }}>
                Bookings from the links you send will arrive here. Your client records stay
                on your devices — the booking page never sees them.
              </Text>
            </View>

            <Pressable onPress={startScanning} style={[styles.scanBtn, { backgroundColor: theme.accent }]}>
              <Icons.barcode size={18} color="#fff" />
              <Text style={styles.scanBtnText}>Scan a code</Text>
            </Pressable>
            <Text style={{ fontSize: 13, lineHeight: 19, color: theme.ink3, marginTop: -12 }}>
              From your service's setup page, or from a device you've already linked.
            </Text>

            <View style={{ gap: 7 }}>
              <Text style={[styles.label, { color: theme.ink3 }]}>OR PASTE THE CODE</Text>
              <TextInput
                testID="setup-code"
                style={[styles.input, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }]}
                value={pasted}
                onChangeText={setPasted}
                placeholder="Copy it from the setup page"
                placeholderTextColor={theme.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              {!!pasted.trim() && (
                <Pressable
                  onPress={async () => { await applyCode(pasted); setPasted(''); }}
                  disabled={busy}
                  style={[styles.scanBtn, { backgroundColor: busy ? theme.bg2 : theme.heroBg }]}
                >
                  {busy
                    ? <ActivityIndicator color={theme.ink2} />
                    : <Text style={styles.scanBtnText}>Use this code</Text>}
                </Pressable>
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
              <Text style={{ fontSize: 12, color: theme.ink3 }}>or set it up here</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
            </View>

            <View style={{ gap: 14 }}>
              <View style={{ gap: 7 }}>
                <Text style={[styles.label, { color: theme.ink3 }]}>BOOKING ADDRESS</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }]}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://book.yourstudio.co.uk"
                  placeholderTextColor={theme.ink3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
              <View style={{ gap: 7 }}>
                <Text style={[styles.label, { color: theme.ink3 }]}>DEVICE KEY</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }]}
                  value={deviceKey}
                  onChangeText={setDeviceKey}
                  placeholder="Paste the key from your service"
                  placeholderTextColor={theme.ink3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
              </View>
            </View>

            <Pressable
              onPress={linkByTyping}
              disabled={busy}
              style={[styles.scanBtn, { backgroundColor: busy ? theme.bg2 : theme.heroBg }]}
            >
              {busy
                ? <ActivityIndicator color={theme.ink2} />
                : <Text style={styles.scanBtnText}>Link this device</Text>}
            </Pressable>
          </ScrollView>
        )}
        {dialog}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: SERIF, textAlign: 'center' },
  title: { fontSize: 28, fontFamily: SERIF, letterSpacing: -0.5 },
  label: { fontSize: 10, letterSpacing: 1.2, fontWeight: '600' },
  input: { borderWidth: 0.5, borderRadius: 14, paddingHorizontal: 16, minHeight: 52, fontSize: 15 },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    minHeight: 54, borderRadius: 14,
  },
  scanBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 16, borderWidth: 0.5,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12.5, marginTop: 2 },
  tick: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  qrWrap: { padding: 20, borderRadius: 20 },
  qrCaption: { fontSize: 14.5, lineHeight: 20, textAlign: 'center', paddingHorizontal: 10 },
  scanHint: { alignItems: 'center', paddingBottom: 40 },
  scanHintText: {
    color: '#fff', fontSize: 15, fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14,
  },
});
