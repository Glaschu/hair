import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, Modal, FlatList, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useApp, ExportPayload } from '../../data/AppContext';
import { useDialog } from '../../data/DialogContext';
import { useResponsive } from '../../hooks/useResponsive';
import { DEFAULT_SCHEDULE } from '../../data/mockData';
import { RootStackParamList } from '../../navigation/types';
import { Icons, RoundBtn } from '../../components';
import { accentOptions } from '../../theme';
import { fmt } from '../../data/utils';
import { requestNotificationPermission } from '../../data/notifications';
import { getOrCreateIrisCalendar, deleteIrisCalendar } from '../../data/calendarSync';
import { readAutoBackup } from '../../data/backup';
import { Eyebrow, Title, Btn } from '../ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const LEAD_OPTIONS = [
  { label: '15 min', minutes: 15 }, { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 }, { label: '2 hours', minutes: 120 },
];
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) { TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`); if (h < 22) TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`); }

type SectionId = 'studio' | 'appearance' | 'reminders' | 'hours' | 'services' | 'sync' | 'data';
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'studio', label: 'Studio' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'hours', label: 'Working hours' },
  { id: 'services', label: 'Services' },
  { id: 'sync', label: 'Sync' },
  { id: 'data', label: 'Data' },
];

// ── Module-level presentational helpers (stable identity so inputs keep focus) ──
function Card({ children }: { children: React.ReactNode }) {
  const { theme } = useApp();
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>{children}</View>;
}
function Divider() { const { theme } = useApp(); return <View style={{ height: 0.5, backgroundColor: theme.line, marginVertical: 12 }} />; }
function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  const { theme } = useApp();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '500', color: theme.ink }}>{label}</Text>
        {sub && <Text style={{ fontSize: 12, color: theme.ink3, marginTop: 2 }}>{sub}</Text>}
      </View>
      {children}
    </View>
  );
}
function ColRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const { theme } = useApp();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '500', color: theme.ink }}>{label}</Text>
        {hint && <Text style={{ fontSize: 11, color: theme.ink3 }}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}
function ChipGroup({ options, value, labels, onChange }: { options: string[]; value: string; labels: Record<string, string>; onChange: (v: string) => void }) {
  const { theme } = useApp();
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const a = value === o;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, backgroundColor: a ? theme.accent + '20' : theme.bg2, borderColor: a ? theme.accent : 'transparent' }}>
            <Text style={{ fontSize: 13, color: a ? theme.accent : theme.ink2, fontWeight: a ? '700' : '500' }}>{labels[o]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Toggle({ on, onPress }: { on: boolean; onPress: () => void }) {
  const { theme } = useApp();
  return (
    <Pressable onPress={onPress} style={{ width: 50, height: 28, borderRadius: 14, justifyContent: 'center', backgroundColor: on ? theme.accent : theme.bg2 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', transform: [{ translateX: on ? 22 : 2 }] }} />
    </Pressable>
  );
}
function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Eyebrow style={{ flex: 1 }}>{title}</Eyebrow>
        {action}
      </View>
      {children}
    </View>
  );
}
function DataRow({ icon, bg, label, sub, labelColor, subColor, onPress, busy }: { icon: React.ReactNode; bg: string; label: string; sub: string; labelColor?: string; subColor?: string; onPress: () => void; busy?: boolean }) {
  const { theme } = useApp();
  return (
    <Pressable onPress={onPress} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: busy ? 0.5 : 1 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '500', color: labelColor ?? theme.ink }}>{label}</Text>
        <Text style={{ fontSize: 12, color: subColor ?? theme.ink3, marginTop: 2 }}>{sub}</Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={theme.ink3} /> : <Icons.chevronRight size={16} color={theme.ink3} />}
    </Pressable>
  );
}

export function SettingsIPad() {
  const app = useApp();
  const { theme } = app;
  const dialog = useDialog();
  const { isLandscape } = useResponsive();
  const nav = useNavigation<Nav>();
  const [active, setActive] = useState<SectionId>('studio');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(app.studioName);
  const [timePicker, setTimePicker] = useState<{ day: number; field: 'start' | 'end' } | null>(null);
  const [busy, setBusy] = useState<'' | 'export' | 'import'>('');
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  const handleExport = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const payload: ExportPayload = { version: 1, exported: new Date().toISOString(), clients: app.clients, products: app.products, appointments: app.appointments, services: app.services, schedule: app.schedule };
      const file = new File(Paths.document, 'iris-export.json');
      file.write(JSON.stringify(payload, null, 2));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export Iris data' });
      app.markExported();
    } finally { setBusy(''); }
  };

  const handleImport = async () => {
    if (busy) return;
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    setBusy('import');
    try {
      const text = new File(result.assets[0].uri).textSync();
      const data: ExportPayload = JSON.parse(text);
      if (data.version !== 1 || !Array.isArray(data.clients) || !Array.isArray(data.products) || !Array.isArray(data.appointments) || !Array.isArray(data.services) || typeof data.schedule !== 'object' || data.schedule === null) throw new Error('Invalid');
      app.loadFromExport(data);
      await dialog.alert({ title: 'Import complete', message: `Loaded ${data.clients.length} clients, ${data.products.length} products, ${data.appointments.length} appointments.` });
    } catch {
      await dialog.alert({ title: 'Export Failed', message: 'An error occurred while exporting data.' });
    } finally {
      setBusy('');
    }
  };

  const handleToggleReminders = async () => {
    if (app.remindersEnabled) { app.setRemindersEnabled(false); return; }
    const granted = await requestNotificationPermission();
    if (!granted) { await dialog.alert({ title: 'Notifications are off', message: 'Turn on notifications for Iris in your device settings to get appointment reminders.' }); return; }
    app.setRemindersEnabled(true);
  };

  const handleToggleCalendarSync = async () => {
    if (app.calendarSyncEnabled) {
      if (app.appleCalendarId) {
        await deleteIrisCalendar(app.appleCalendarId);
      }
      app.setCalendarSyncEnabled(false);
      app.setAppleCalendarId(null);
      return;
    }
    const calId = await getOrCreateIrisCalendar();
    if (!calId) { await dialog.alert({ title: 'Permission Denied', message: 'Iris needs calendar access to sync appointments. Enable it in your device settings.' }); return; }
    app.setAppleCalendarId(calId); app.setCalendarSyncEnabled(true);
  };

  const handleToggleICloudSync = async () => {
    if (app.iCloudSyncEnabled) {
      app.setICloudSyncEnabled(false);
      return;
    }
    const { CloudStorage } = require('react-native-cloud-storage');
    try {
      const available = await CloudStorage.isCloudAvailable();
      if (!available) {
        await dialog.alert({
          title: 'iCloud Unavailable',
          message: 'Could not enable iCloud sync. Ensure you are signed into an Apple ID with iCloud Drive enabled for Iris.',
        });
        return;
      }
      app.setICloudSyncEnabled(true);
    } catch {
      await dialog.alert({
        title: 'iCloud Unavailable',
        message: 'Could not enable iCloud sync. Ensure you are signed into iCloud and iCloud Drive is enabled for Iris.',
      });
    }
  };

  const handleManualSync = async () => {
    if (busy) return;
    setBusy('sync' as any);
    try {
      const didPull = await app.forceSync();
      await dialog.alert({
        title: didPull ? 'Sync Complete' : 'Pushed to iCloud',
        message: didPull 
          ? 'iCloud has successfully synced the latest changes.' 
          : 'Your data was pushed, but no new changes were found in iCloud to pull. If you expect changes, ensure iCloud Drive is enabled and wait a moment for Apple servers to sync.',
      });
    } catch (e: any) {
      await dialog.alert({
        title: 'Sync Error',
        message: e?.message || 'Could not sync with iCloud.',
      });
    } finally {
      setBusy('');
    }
  };

  const handleRestoreAuto = async () => {
    const data = readAutoBackup();
    if (!data) { await dialog.alert({ title: 'No automatic backup yet', message: "Iris saves a snapshot each time you close the app — there isn't one to restore yet." }); return; }
    const ok = await dialog.confirm({ title: 'Restore automatic backup', message: `This replaces all current data with the snapshot from ${fmt.day(data.exported)}.`, confirmLabel: 'Restore', tone: 'destructive' });
    if (!ok) return;
    app.loadFromExport(data);
    await dialog.alert({ title: 'Backup restored', message: 'Your most recent automatic backup has been loaded.' });
  };

  const handleReset = async () => {
    const idx = await dialog.actionSheet({ title: 'Reset data', message: 'Choose an option:', actions: [{ label: 'Reset to demo data' }, { label: 'Wipe everything', destructive: true }] });
    if (idx === 0) { app.resetToDemo(); await dialog.alert({ title: 'Done', message: 'Data reset to demo state.' }); }
    else if (idx === 1) { app.loadFromExport({ version: 1, exported: '', clients: [], products: [], appointments: [], services: [], schedule: DEFAULT_SCHEDULE }); await dialog.alert({ title: 'Done', message: 'All data wiped.' }); }
  };

  const saveName = () => { if (nameInput.trim()) app.setStudioName(nameInput.trim()); setEditingName(false); };
  const backupStale = !app.lastExportAt || Date.now() - new Date(app.lastExportAt).getTime() > 7 * 86400000;

  const sectionContent = (id: SectionId): React.ReactNode => {
    switch (id) {
      case 'studio':
        return (
          <Block title="STUDIO NAME">
            <Card>
              {editingName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TextInput style={{ flex: 1, fontSize: 17, borderWidth: 0.5, borderColor: theme.line, borderRadius: 10, padding: 10, color: theme.ink }} value={nameInput} onChangeText={setNameInput} autoFocus onSubmitEditing={saveName} />
                  <RoundBtn size={38} filled onPress={saveName}><Icons.check size={16} color="#fff" /></RoundBtn>
                </View>
              ) : (
                <Pressable onPress={() => { setEditingName(true); setNameInput(app.studioName); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 22, fontWeight: '500', fontStyle: 'italic', color: theme.ink }}>{app.studioName}</Text>
                  <Icons.edit size={16} color={theme.ink3} />
                </Pressable>
              )}
            </Card>
          </Block>
        );
      case 'appearance':
        return (
          <Block title="APPEARANCE">
            <Card>
              <Row label="Dark mode"><Toggle on={app.dark} onPress={() => app.setDark(!app.dark)} /></Row>
              <Divider />
              <ColRow label="Calendar density" hint="Day mode only">
                <ChipGroup options={['compact', 'regular', 'comfy']} value={app.density} labels={{ compact: 'Compact', regular: 'Regular', comfy: 'Comfy' }} onChange={(v) => app.setDensity(v as any)} />
              </ColRow>
              <Divider />
              <ColRow label="Booking window" hint="How far ahead clients can book">
                <ChipGroup options={['14', '30', '60', '90']} value={String(app.bookingWindowDays)} labels={{ '14': '2 wks', '30': '1 mo', '60': '2 mo', '90': '3 mo' }} onChange={(v) => app.setBookingWindowDays(Number(v))} />
              </ColRow>
              <Divider />
              <ColRow label="Accent colour">
                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                  {accentOptions.map((c) => (
                    <Pressable key={c} onPress={() => app.setAccent(c)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c, borderWidth: app.accent === c ? 3 : 1, borderColor: app.accent === c ? '#fff' : theme.ink3 + '55' }} />
                  ))}
                </View>
              </ColRow>
            </Card>
          </Block>
        );
      case 'reminders':
        return (
          <Block title="REMINDERS">
            <Card>
              <Row label="Appointment reminders" sub="A notification before each appointment"><Toggle on={app.remindersEnabled} onPress={handleToggleReminders} /></Row>
              {app.remindersEnabled && (
                <>
                  <Divider />
                  <ColRow label="Remind me before">
                    <ChipGroup options={LEAD_OPTIONS.map((l) => String(l.minutes))} value={String(app.reminderLeadMinutes)} labels={Object.fromEntries(LEAD_OPTIONS.map((l) => [String(l.minutes), l.label]))} onChange={(v) => app.setReminderLeadMinutes(Number(v))} />
                  </ColRow>
                </>
              )}
            </Card>
          </Block>
        );
      case 'hours':
        return (
          <Block title="WORKING HOURS">
            <Card>
              {DAY_ORDER.map((day, idx) => {
                const info = app.schedule[day];
                if (!info) return null;
                return (
                  <View key={day}>
                    {idx > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                      <Text style={{ width: 40, fontWeight: '600', fontSize: 14, color: theme.ink }}>{DAY_NAMES[day]}</Text>
                      {info.open ? (
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Pressable onPress={() => setTimePicker({ day, field: 'start' })} style={[styles.timeChip, { backgroundColor: theme.bg2 }]}><Text style={{ color: theme.ink, fontSize: 13, fontWeight: '500' }}>{info.start}</Text></Pressable>
                          <Text style={{ color: theme.ink3 }}>–</Text>
                          <Pressable onPress={() => setTimePicker({ day, field: 'end' })} style={[styles.timeChip, { backgroundColor: theme.bg2 }]}><Text style={{ color: theme.ink, fontSize: 13, fontWeight: '500' }}>{info.end}</Text></Pressable>
                        </View>
                      ) : <Text style={{ flex: 1, color: theme.ink3, fontSize: 13 }}>Closed</Text>}
                      <Toggle on={info.open} onPress={() => app.setSchedule((prev) => ({ ...prev, [day]: { ...prev[day], open: !prev[day].open } }))} />
                    </View>
                  </View>
                );
              })}
            </Card>
          </Block>
        );
      case 'services':
        return (
          <Block title="SERVICES" action={<Btn compact variant="primary" icon={<Icons.plus size={14} color="#fff" />} onPress={() => nav.navigate('ServiceForm', {})}>Add</Btn>}>
            <View style={{ gap: 8 }}>
              {app.services.map((svc) => (
                <Pressable key={svc.id} onPress={() => nav.navigate('ServiceForm', { serviceId: svc.id })} style={[styles.svcRow, { backgroundColor: theme.card, borderColor: theme.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 15, color: theme.ink }}>{svc.name}</Text>
                    <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 2 }}>{fmt.duration(svc.duration)} · {fmt.currency(svc.price)}{svc.defaults.length > 0 ? ` · ${svc.defaults.length} product${svc.defaults.length > 1 ? 's' : ''}` : ''}</Text>
                  </View>
                  <Icons.chevronRight size={16} color={theme.ink3} />
                </Pressable>
              ))}
            </View>
          </Block>
        );
      case 'sync':
        return (
          <Block title="SYNC">
            <Card>
              <Row label="Sync with Apple Calendar" sub="Automatically mirror your appointments"><Toggle on={app.calendarSyncEnabled} onPress={handleToggleCalendarSync} /></Row>
              <Divider />
              <Row label="Sync across devices" sub="Securely sync clients and appointments over iCloud"><Toggle on={app.iCloudSyncEnabled} onPress={handleToggleICloudSync} /></Row>
              {app.iCloudSyncEnabled && (
                <>
                  <Divider />
                  <Pressable
                    onPress={handleManualSync}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '600', color: theme.accent }}>Force Sync Now</Text>
                  </Pressable>
                </>
              )}
            </Card>
          </Block>
        );
      case 'data':
        return (
          <Block title="DATA">
            <Card>
              <DataRow icon={<Icons.star size={16} color={theme.accent} />} bg={theme.accent + '18'} label="What's New in Iris" sub="See the latest features" onPress={() => setWhatsNewOpen(true)} />
              <Divider />
              <DataRow icon={<Icons.trend size={16} color={theme.accent} />} bg={theme.accent + '18'} label="Back up data" sub={app.lastExportAt ? `Last backed up ${fmt.ago(app.lastExportAt)}` : 'Not backed up yet'} subColor={backupStale ? theme.warn : theme.ink3} onPress={handleExport} busy={busy === 'export'} />
              <Divider />
              <DataRow icon={<Icons.clipboardCheck size={16} color={theme.sage} />} bg={theme.sage + '25'} label="Import data" sub="Load from a previously exported file" onPress={handleImport} busy={busy === 'import'} />
              <Divider />
              <DataRow icon={<Icons.clipboardCheck size={16} color={theme.ink2} />} bg={theme.ink3 + '22'} label="Restore automatic backup" sub="Recover from Iris's latest on-device snapshot" onPress={handleRestoreAuto} />
              <Divider />
              <DataRow icon={<Icons.alert size={16} color={theme.danger} />} bg={theme.danger + '18'} label="Reset / wipe data" labelColor={theme.danger} sub="Reset to demo or wipe everything" onPress={handleReset} />
            </Card>
          </Block>
        );
    }
  };

  return (
    <>
      {isLandscape ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={[styles.navPane, { width: 232, borderRightWidth: 0.5, borderRightColor: theme.line }]}>
            <View style={{ paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8 }}>
              <Eyebrow>STUDIO</Eyebrow>
              <Title size={34} style={{ marginTop: 2 }}>Settings</Title>
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              {SECTIONS.map((s) => (
                <Pressable key={s.id} onPress={() => setActive(s.id)} style={[styles.navItem, active === s.id && { backgroundColor: theme.card, borderColor: theme.line, borderWidth: 0.5 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: active === s.id ? theme.ink : theme.ink2 }}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 32, maxWidth: 760 }} showsVerticalScrollIndicator={false}>
            {sectionContent(active)}
          </ScrollView>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 28, paddingTop: 18 }}>
            <Eyebrow>STUDIO</Eyebrow>
            <Title size={30} style={{ marginTop: 2 }}>Settings</Title>
          </View>
          <ScrollView contentContainerStyle={{ padding: 28, gap: 24 }} showsVerticalScrollIndicator={false}>
            {SECTIONS.map((s) => <View key={s.id}>{sectionContent(s.id)}</View>)}
          </ScrollView>
        </View>
      )}

      {/* Time picker */}
      <Modal visible={timePicker !== null} transparent animationType="fade" onRequestClose={() => setTimePicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setTimePicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.card }]} onPress={() => {}}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.ink, textAlign: 'center', marginBottom: 12 }}>
              {timePicker ? `${DAY_NAMES[timePicker.day]} · ${timePicker.field === 'start' ? 'Opens' : 'Closes'}` : ''}
            </Text>
            <FlatList
              data={TIME_OPTIONS}
              keyExtractor={(t) => t}
              style={{ maxHeight: 320 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const sel = timePicker && app.schedule[timePicker.day][timePicker.field] === item;
                return (
                  <Pressable onPress={() => { if (timePicker) { app.setSchedule((prev) => ({ ...prev, [timePicker.day]: { ...prev[timePicker.day], [timePicker.field]: item } })); setTimePicker(null); } }} style={[styles.timeOption, sel && { backgroundColor: theme.accent + '20' }]}>
                    <Text style={{ fontSize: 16, color: sel ? theme.accent : theme.ink, fontWeight: sel ? '700' : '400' }}>{item}</Text>
                    {sel && <Icons.check size={16} color={theme.accent} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* What's New modal */}
      <Modal visible={whatsNewOpen} transparent animationType="slide" onRequestClose={() => setWhatsNewOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: theme.bg, flex: 0.85, marginTop: 'auto', width: '100%', maxWidth: 500, alignSelf: 'center', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
            <View style={{ width: 40, height: 5, backgroundColor: theme.line, borderRadius: 3, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ color: theme.ink, fontSize: 20, marginBottom: 24, fontWeight: '700' }}>What's New</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 60 }}>
              
              <View style={{ marginBottom: 24, flexDirection: 'row', gap: 16 }}>
                <View style={{ backgroundColor: theme.accent + '18', width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.layout size={18} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>All-New iPad Mode</Text>
                  <Text style={{ fontSize: 13, color: theme.ink2, marginTop: 4, lineHeight: 18 }}>Iris now features a beautiful, multi-column layout optimized specifically for the iPad's larger screen.</Text>
                </View>
              </View>

              <View style={{ marginBottom: 24, flexDirection: 'row', gap: 16 }}>
                <View style={{ backgroundColor: theme.sage + '25', width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.cloud size={18} color={theme.sage} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>Seamless iCloud Sync</Text>
                  <Text style={{ fontSize: 13, color: theme.ink2, marginTop: 4, lineHeight: 18 }}>Turn on iCloud Sync to effortlessly keep your clients, appointments, and products perfectly in sync between your iPhone and iPad.</Text>
                </View>
              </View>

              <View style={{ marginBottom: 24, flexDirection: 'row', gap: 16 }}>
                <View style={{ backgroundColor: '#8a3ab925', width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                  <Icons.calendar size={18} color="#8a3ab9" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', fontSize: 15, color: theme.ink }}>Smart Calendar Deduplication</Text>
                  <Text style={{ fontSize: 13, color: theme.ink2, marginTop: 4, lineHeight: 18 }}>Iris now intelligently recognizes appointments synced across your Apple devices and links them automatically, eliminating duplicate events in your Apple Calendar.</Text>
                </View>
              </View>

            </ScrollView>
            <View style={{ paddingVertical: 10 }}>
              <Pressable onPress={() => setWhatsNewOpen(false)} style={{ backgroundColor: theme.accent, borderRadius: 14, padding: 16, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  navPane: { height: '100%' },
  navItem: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, marginTop: 2, borderWidth: 0.5, borderColor: 'transparent' },
  card: { borderRadius: 16, borderWidth: 0.5, padding: 18 },
  svcRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 0.5, padding: 14 },
  timeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 40 },
  sheet: { width: 360, maxWidth: '100%', borderRadius: 18, padding: 18 },
  timeOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
});
