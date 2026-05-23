import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useApp, ExportPayload } from '../data/AppContext';
import { useDialog } from '../data/DialogContext';
import { DEFAULT_SCHEDULE } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';
import { Card, Icons, RoundBtn } from '../components';
import { accentOptions } from '../theme';
import { fmt } from '../data/utils';
import { requestNotificationPermission } from '../data/notifications';
import { readAutoBackup } from '../data/backup';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const LEAD_OPTIONS: { label: string; minutes: number }[] = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
];

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:00`);
  if (h < 22) TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:30`);
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const { theme, studioName, setStudioName, dark, setDark, accent, setAccent, services, setServices, schedule, setSchedule, density, setDensity, bookingWindowDays, setBookingWindowDays, remindersEnabled, setRemindersEnabled, reminderLeadMinutes, setReminderLeadMinutes, lastExportAt, markExported, clients, products, appointments, resetToDemo, loadFromExport } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(studioName);
  const [timePicker, setTimePicker] = useState<{ day: number; field: 'start' | 'end' } | null>(null);
  const [busy, setBusy] = useState<null | 'export' | 'import'>(null);

  const handleExport = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const payload: ExportPayload = {
        version: 1,
        exported: new Date().toISOString(),
        clients,
        products,
        appointments,
        services,
        schedule,
      };
      const json = JSON.stringify(payload, null, 2);
      const file = new File(Paths.document, 'iris-export.json');
      file.write(json);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export Iris data' });
      markExported();
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    if (busy) return;
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    setBusy('import');
    try {
      const file = new File(result.assets[0].uri);
      const text = file.textSync();
      const data: ExportPayload = JSON.parse(text);
      if (
        data.version !== 1 ||
        !Array.isArray(data.clients) ||
        !Array.isArray(data.products) ||
        !Array.isArray(data.appointments) ||
        !Array.isArray(data.services) ||
        typeof data.schedule !== 'object' || data.schedule === null
      ) throw new Error('Invalid format');
      loadFromExport(data);
      await dialog.alert({
        title: 'Import complete',
        message: `Loaded ${data.clients.length} clients, ${data.products.length} products, ${data.appointments.length} appointments.`,
      });
    } catch {
      await dialog.alert({
        title: 'Import failed',
        message: 'The file could not be read. Make sure it was exported from Iris.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleToggleReminders = async () => {
    if (remindersEnabled) {
      setRemindersEnabled(false);
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      await dialog.alert({
        title: 'Notifications are off',
        message: 'Turn on notifications for Iris in your device settings to get appointment reminders.',
      });
      return;
    }
    setRemindersEnabled(true);
  };

  const handleRestoreAuto = async () => {
    const data = readAutoBackup();
    if (!data) {
      await dialog.alert({
        title: 'No automatic backup yet',
        message: 'Iris saves a snapshot each time you close the app — there isn\'t one to restore yet.',
      });
      return;
    }
    const ok = await dialog.confirm({
      title: 'Restore automatic backup',
      message: `This replaces all current data with the snapshot from ${fmt.day(data.exported)}.`,
      confirmLabel: 'Restore',
      tone: 'destructive',
    });
    if (!ok) return;
    loadFromExport(data);
    await dialog.alert({
      title: 'Backup restored',
      message: 'Your most recent automatic backup has been loaded.',
    });
  };

  const backupStale = !lastExportAt
    || Date.now() - new Date(lastExportAt).getTime() > 7 * 86400000;
  const backupSub = lastExportAt ? `Last backed up ${fmt.ago(lastExportAt)}` : 'Not backed up yet';

  const handleReset = async () => {
    const idx = await dialog.actionSheet({
      title: 'Reset data',
      message: 'Choose an option:',
      actions: [
        { label: 'Reset to demo data' },
        { label: 'Wipe everything', destructive: true },
      ],
    });
    if (idx === 0) {
      resetToDemo();
      await dialog.alert({ title: 'Done', message: 'Data reset to demo state.' });
    } else if (idx === 1) {
      loadFromExport({ version: 1, exported: '', clients: [], products: [], appointments: [], services: [], schedule: DEFAULT_SCHEDULE });
      await dialog.alert({ title: 'Done', message: 'All data wiped.' });
    }
  };

  const toggleDay = (day: number) => {
    setSchedule((prev) => ({ ...prev, [day]: { ...prev[day], open: !prev[day].open } }));
  };

  const setTime = (day: number, field: 'start' | 'end', value: string) => {
    setSchedule((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const saveName = () => {
    if (nameInput.trim()) setStudioName(nameInput.trim());
    setEditingName(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <RoundBtn onPress={() => nav.goBack()} size={38}>
            <Icons.chevronLeft size={18} color={theme.ink} />
          </RoundBtn>
          <Text style={[styles.title, { color: theme.ink }]}>Settings</Text>
          <View style={{ width: 38 }} />
        </View>

        {/* Studio name */}
        <View style={[styles.section, { paddingHorizontal: 20 }]}>
          <Text style={[styles.label, { color: theme.ink3 }]}>STUDIO NAME</Text>
          <Card>
            {editingName ? (
              <View style={styles.nameEditRow}>
                <TextInput
                  style={[styles.nameInput, { color: theme.ink, borderColor: theme.line }]}
                  value={nameInput}
                  onChangeText={setNameInput}
                  autoFocus
                  onSubmitEditing={saveName}
                />
                <Pressable onPress={saveName} style={[styles.saveBtn, { backgroundColor: theme.accent }]}>
                  <Icons.check size={16} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.nameRow} onPress={() => { setEditingName(true); setNameInput(studioName); }}>
                <Text style={[styles.nameValue, { color: theme.ink }]}>{studioName}</Text>
                <Icons.edit size={16} color={theme.ink3} />
              </Pressable>
            )}
          </Card>
        </View>

        {/* Appearance */}
        <View style={[styles.section, { paddingHorizontal: 20 }]}>
          <Text style={[styles.label, { color: theme.ink3 }]}>APPEARANCE</Text>
          <Card>
            {/* Dark mode */}
            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: theme.ink }]}>Dark Mode</Text>
              <Pressable
                onPress={() => setDark(!dark)}
                style={[styles.toggleTrack, { backgroundColor: dark ? theme.accent : theme.bg2 }]}
              >
                <View style={[styles.toggleThumb, { transform: [{ translateX: dark ? 22 : 2 }] }]} />
              </Pressable>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            {/* Calendar density */}
            <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                <Text style={[styles.settingLabel, { color: theme.ink }]}>Calendar Density</Text>
                <Text style={{ fontSize: 11, color: theme.ink3 }}>Day mode only</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['compact', 'regular', 'comfy'] as const).map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => setDensity(d)}
                    style={[styles.densityChip, {
                      backgroundColor: density === d ? theme.accent + '20' : theme.bg2,
                      borderColor: density === d ? theme.accent : 'transparent',
                    }]}
                  >
                    <Text style={[styles.densityChipText, { color: density === d ? theme.accent : theme.ink2, fontWeight: density === d ? '700' : '500' }]}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            {/* Booking window */}
            <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                <Text style={[styles.settingLabel, { color: theme.ink }]}>Booking Window</Text>
                <Text style={{ fontSize: 11, color: theme.ink3 }}>How far ahead clients can book</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([14, 30, 60, 90] as const).map((days) => {
                  const label = days === 14 ? '2 wks' : days === 30 ? '1 mo' : days === 60 ? '2 mo' : '3 mo';
                  const active = bookingWindowDays === days;
                  return (
                    <Pressable
                      key={days}
                      onPress={() => setBookingWindowDays(days)}
                      style={[styles.densityChip, {
                        backgroundColor: active ? theme.accent + '20' : theme.bg2,
                        borderColor: active ? theme.accent : 'transparent',
                      }]}
                    >
                      <Text style={[styles.densityChipText, { color: active ? theme.accent : theme.ink2, fontWeight: active ? '700' : '500' }]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            {/* Accent */}
            <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={[styles.settingLabel, { color: theme.ink, marginBottom: 12 }]}>Accent Colour</Text>
              <View style={styles.accentRow}>
                {accentOptions.map((color) => (
                  <Pressable
                    key={color}
                    onPress={() => setAccent(color)}
                    style={[styles.accentSwatch, {
                      backgroundColor: color,
                      borderWidth: accent === color ? 3 : 0,
                      borderColor: '#fff',
                      shadowColor: color,
                      shadowOpacity: accent === color ? 0.4 : 0,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
                    }]}
                  />
                ))}
              </View>
            </View>
          </Card>
        </View>

        {/* Reminders */}
        <View style={[styles.section, { paddingHorizontal: 20 }]}>
          <Text style={[styles.label, { color: theme.ink3 }]}>REMINDERS</Text>
          <Card>
            <View style={styles.settingRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.settingLabel, { color: theme.ink }]}>Appointment reminders</Text>
                <Text style={{ fontSize: 11, color: theme.ink3, marginTop: 2 }}>
                  A notification before each appointment
                </Text>
              </View>
              <Pressable
                onPress={handleToggleReminders}
                style={[styles.toggleTrack, { backgroundColor: remindersEnabled ? theme.accent : theme.bg2 }]}
              >
                <View style={[styles.toggleThumb, { transform: [{ translateX: remindersEnabled ? 22 : 2 }] }]} />
              </Pressable>
            </View>
            {remindersEnabled && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.line }]} />
                <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                  <Text style={[styles.settingLabel, { color: theme.ink, marginBottom: 12 }]}>Remind me before</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {LEAD_OPTIONS.map(({ label, minutes }) => {
                      const active = reminderLeadMinutes === minutes;
                      return (
                        <Pressable
                          key={minutes}
                          onPress={() => setReminderLeadMinutes(minutes)}
                          style={[styles.densityChip, {
                            backgroundColor: active ? theme.accent + '20' : theme.bg2,
                            borderColor: active ? theme.accent : 'transparent',
                          }]}
                        >
                          <Text style={[styles.densityChipText, { color: active ? theme.accent : theme.ink2, fontWeight: active ? '700' : '500' }]}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            )}
          </Card>
        </View>

        {/* Working hours */}
        <View style={[styles.section, { paddingHorizontal: 20 }]}>
          <Text style={[styles.label, { color: theme.ink3 }]}>WORKING HOURS</Text>
          <Card>
            {DAY_ORDER.map((day, idx) => {
              const info = schedule[day];
              return (
                <React.Fragment key={day}>
                  {idx > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
                  <View style={styles.dayRow}>
                    <Text style={[styles.dayName, { color: theme.ink }]}>{DAY_NAMES[day]}</Text>
                    {info.open ? (
                      <View style={styles.dayTimes}>
                        <Pressable
                          onPress={() => setTimePicker({ day, field: 'start' })}
                          style={[styles.timeChip, { backgroundColor: theme.bg2 }]}
                        >
                          <Text style={[styles.timeChipText, { color: theme.ink }]}>{info.start}</Text>
                        </Pressable>
                        <Text style={[styles.timeSep, { color: theme.ink3 }]}>–</Text>
                        <Pressable
                          onPress={() => setTimePicker({ day, field: 'end' })}
                          style={[styles.timeChip, { backgroundColor: theme.bg2 }]}
                        >
                          <Text style={[styles.timeChipText, { color: theme.ink }]}>{info.end}</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={[styles.closedText, { color: theme.ink3 }]}>Closed</Text>
                    )}
                    <Pressable
                      onPress={() => toggleDay(day)}
                      style={[styles.toggleTrack, { backgroundColor: info.open ? theme.accent : theme.bg2 }]}
                    >
                      <View style={[styles.toggleThumb, { transform: [{ translateX: info.open ? 22 : 2 }] }]} />
                    </Pressable>
                  </View>
                </React.Fragment>
              );
            })}
          </Card>
        </View>

        {/* Services */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.label, { color: theme.ink3 }]}>SERVICES</Text>
            <Pressable
              onPress={() => nav.navigate('ServiceForm', {})}
              style={[styles.addBtn, { backgroundColor: theme.accent }]}
            >
              <Icons.plus size={14} color="#fff" />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>

          {services.map((svc) => (
            <Pressable
              key={svc.id}
              onPress={() => nav.navigate('ServiceForm', { serviceId: svc.id })}
              style={[styles.svcRow, { backgroundColor: theme.card, borderColor: theme.line }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.svcName, { color: theme.ink }]}>{svc.name}</Text>
                <Text style={[styles.svcMeta, { color: theme.ink3 }]}>
                  {fmt.duration(svc.duration)} · {fmt.currency(svc.price)}
                  {svc.defaults.length > 0 && ` · ${svc.defaults.length} product${svc.defaults.length > 1 ? 's' : ''}`}
                </Text>
              </View>
              <Icons.chevronRight size={16} color={theme.ink3} />
            </Pressable>
          ))}
        </View>
        {/* Data tools */}
        <View style={[styles.section, { paddingHorizontal: 20 }]}>
          <Text style={[styles.label, { color: theme.ink3 }]}>DATA</Text>
          <Card>
            <Pressable style={[styles.dataRow, busy !== null && { opacity: 0.5 }]} onPress={handleExport} disabled={busy !== null}>
              <View style={[styles.dataIcon, { backgroundColor: theme.accent + '18' }]}>
                <Icons.trend size={16} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dataLabel, { color: theme.ink }]}>Back up data</Text>
                <Text style={[styles.dataSub, { color: backupStale ? theme.warn : theme.ink3 }]}>{backupSub}</Text>
              </View>
              {busy === 'export'
                ? <ActivityIndicator size="small" color={theme.ink3} />
                : <Icons.chevronRight size={16} color={theme.ink3} />}
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable style={[styles.dataRow, busy !== null && { opacity: 0.5 }]} onPress={handleImport} disabled={busy !== null}>
              <View style={[styles.dataIcon, { backgroundColor: theme.sage + '25' }]}>
                <Icons.clipboardCheck size={16} color={theme.sage} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dataLabel, { color: theme.ink }]}>Import data</Text>
                <Text style={[styles.dataSub, { color: theme.ink3 }]}>Load from a previously exported file</Text>
              </View>
              {busy === 'import'
                ? <ActivityIndicator size="small" color={theme.ink3} />
                : <Icons.chevronRight size={16} color={theme.ink3} />}
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable style={styles.dataRow} onPress={handleRestoreAuto}>
              <View style={[styles.dataIcon, { backgroundColor: theme.ink3 + '22' }]}>
                <Icons.clipboardCheck size={16} color={theme.ink2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dataLabel, { color: theme.ink }]}>Restore automatic backup</Text>
                <Text style={[styles.dataSub, { color: theme.ink3 }]}>Recover from Iris's latest on-device snapshot</Text>
              </View>
              <Icons.chevronRight size={16} color={theme.ink3} />
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable style={styles.dataRow} onPress={handleReset}>
              <View style={[styles.dataIcon, { backgroundColor: theme.danger + '18' }]}>
                <Icons.alert size={16} color={theme.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dataLabel, { color: theme.danger }]}>Reset / wipe data</Text>
                <Text style={[styles.dataSub, { color: theme.ink3 }]}>Reset to demo or wipe everything</Text>
              </View>
              <Icons.chevronRight size={16} color={theme.ink3} />
            </Pressable>
          </Card>
          <Text style={[styles.dataNote, { color: theme.ink3 }]}>
            Keep an exported file somewhere safe like Files or iCloud. The automatic
            backup guards against changes inside the app — it can't survive a lost phone.
          </Text>
        </View>
      </ScrollView>

      {/* Time picker modal */}
      <Modal visible={timePicker !== null} transparent animationType="slide" onRequestClose={() => setTimePicker(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTimePicker(null)} />
        <View style={[styles.timePickerSheet, { backgroundColor: theme.card }]}>
          <View style={styles.timePickerHandle} />
          <Text style={[styles.timePickerTitle, { color: theme.ink }]}>
            {timePicker ? `${DAY_NAMES[timePicker.day]} · ${timePicker.field === 'start' ? 'Opens' : 'Closes'}` : ''}
          </Text>
          <FlatList
            data={TIME_OPTIONS}
            keyExtractor={(t) => t}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 280 }}
            renderItem={({ item }) => {
              const isSelected = timePicker && schedule[timePicker.day][timePicker.field] === item;
              return (
                <Pressable
                  onPress={() => {
                    if (timePicker) {
                      setTime(timePicker.day, timePicker.field, item);
                      setTimePicker(null);
                    }
                  }}
                  style={[styles.timeOption, isSelected && { backgroundColor: theme.accent + '20' }]}
                >
                  <Text style={[styles.timeOptionText, { color: isSelected ? theme.accent : theme.ink, fontWeight: isSelected ? '700' : '400' }]}>
                    {item}
                  </Text>
                  {isSelected && <Icons.check size={16} color={theme.accent} />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '600', fontStyle: 'italic' },
  section: { marginBottom: 24 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12,
  },
  label: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameValue: { fontSize: 17, fontWeight: '500', fontStyle: 'italic' },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameInput: { flex: 1, fontSize: 17, borderWidth: 0.5, borderRadius: 10, padding: 10 },
  saveBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  settingLabel: { fontSize: 15, fontWeight: '500' },
  divider: { height: 0.5, marginVertical: 10 },
  accentRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  accentSwatch: { width: 36, height: 36, borderRadius: 18 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  svcRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 8,
    borderRadius: 14, borderWidth: 0.5, padding: 14,
  },
  svcName: { fontSize: 15, fontWeight: '600' },
  svcMeta: { fontSize: 12, marginTop: 2 },
  toggleTrack: { width: 50, height: 28, borderRadius: 14, justifyContent: 'center' },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },

  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, gap: 10 },
  dayName: { fontSize: 14, fontWeight: '600', width: 34 },
  dayTimes: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  timeChipText: { fontSize: 13, fontWeight: '500' },
  timeSep: { fontSize: 13 },
  closedText: { flex: 1, fontSize: 13 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  timePickerSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12, paddingBottom: 40,
  },
  timePickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', alignSelf: 'center', marginBottom: 16 },
  timePickerTitle: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 12, paddingHorizontal: 20 },
  timeOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  timeOptionText: { fontSize: 16 },
  timePickerCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  densityChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  densityChipText: { fontSize: 13 },

  dataRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
  dataIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dataLabel: { fontSize: 15, fontWeight: '500' },
  dataSub: { fontSize: 12, marginTop: 2 },
  dataNote: { fontSize: 11, lineHeight: 16, marginTop: 10, paddingHorizontal: 4 },
});
