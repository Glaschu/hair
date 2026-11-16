import React from 'react';
import { View, Text, Modal, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useApp } from '../data/AppContext';
import { SERIF } from '../theme';
import { Icons } from './Icons';

/** "1.0.0 (13)" — marketing version plus the platform build number. */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const build = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode != null
      ? String(Constants.expoConfig.android.versionCode)
      : undefined;
  return build ? `${version} (${build})` : version;
}

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Your data stays with you',
    body: 'Everything you put into Iris — clients, appointments, formulas, notes, inventory — is stored only on this device. Iris has no accounts, no servers, and no one else can see your data.',
  },
  {
    title: 'iCloud sync (optional)',
    body: 'If you turn on iCloud sync, your data and photos are copied to your own personal iCloud Drive so your other devices can stay up to date. That storage belongs to your Apple ID and is governed by Apple’s privacy terms; it is never visible to the makers of Iris.',
  },
  {
    title: 'Photos',
    body: 'Client photos you add are resized and stored on this device. They are only ever uploaded if you enable iCloud sync, and then only to your own iCloud Drive.',
  },
  {
    title: 'Device permissions',
    body: 'Iris asks for the camera only to scan product barcodes and take client photos, the photo library only to attach photos you choose, the calendar only when you enable appointment sync, and notifications only for the reminders you turn on. Each permission is optional and used for nothing else.',
  },
  {
    title: 'Analytics and tracking',
    body: 'Iris contains no advertising, no analytics, and no tracking of any kind. If anonymous crash reporting is added in a future version, it will only ever include technical details about the crash, never your salon data.',
  },
  {
    title: 'Your clients’ information',
    body: 'You are in control of the client details you record. You can export everything from Settings at any time, and deleting a client (or the app) removes their information from the device.',
  },
  {
    title: 'Questions',
    body: 'Contact jamesfglasgow@gmail.com with any questions about this policy.',
  },
];

export function PrivacyPolicyModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useApp();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.wrap, { backgroundColor: theme.bg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.ink }]}>Privacy Policy</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Icons.close size={20} color={theme.ink3} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {SECTIONS.map((s) => (
            <View key={s.title} style={{ marginBottom: 22 }}>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>{s.title}</Text>
              <Text style={[styles.sectionBody, { color: theme.ink2 }]}>{s.body}</Text>
            </View>
          ))}
          <Text style={[styles.footer, { color: theme.ink3 }]}>Iris · Version {appVersionLabel()}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12,
  },
  title: { fontFamily: SERIF, fontSize: 28, lineHeight: 32 },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  sectionBody: { fontSize: 14, lineHeight: 21 },
  footer: { fontSize: 12, textAlign: 'center', marginTop: 12 },
});
