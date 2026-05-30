import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Platform, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../data/AppContext';
import { useDialog } from '../data/DialogContext';
import { savePhoto, deletePhoto } from '../db/photos';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Icons, RoundBtn } from '../components';
import { createClient } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ClientForm'>;

const TONE_OPTIONS = [
  '#C49A7A', '#D4A574', '#A0785A', '#8B6349', '#6B4423',
  '#E8C4A0', '#F0D5B5', '#C8A882', '#B8956A', '#7A5C3A',
];

const HAIR_TYPES = ['Straight', 'Wavy', 'Curly', 'Coily'];
const HAIR_LENGTHS = ['Pixie', 'Short', 'Shoulder', 'Mid-length', 'Long'];
const HAIR_NATURALS = ['Dark brown', 'Medium brown', 'Light brown', 'Blonde', 'Red', 'Grey', 'White'];

export default function ClientFormScreen() {
  const { theme, clients, setClients, appointments, setAppointments } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const existing = route.params?.clientId ? clients.find((c) => c.id === route.params.clientId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [instagram, setInstagram] = useState(existing?.instagram || '');
  const [tone, setTone] = useState(existing?.tone || TONE_OPTIONS[0]);
  const [photo, setPhoto] = useState<string | undefined>(existing?.photo);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const pickPhoto = async (useCamera: boolean) => {
    try {
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          await dialog.alert({ title: 'Permission Denied', message: 'Camera access is required.' });
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          await dialog.alert({ title: 'Permission Denied', message: 'Photo library access is required.' });
          return;
        }
      }
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8, mediaTypes: ['images'] });
      if (!result.canceled && result.assets[0]) {
        setSavingPhoto(true);
        try {
          const uri = await savePhoto(result.assets[0].uri);
          if (photo) await deletePhoto(photo);
          setPhoto(uri);
        } catch {
          await dialog.alert({
            title: "Couldn't save photo",
            message: 'The photo could not be saved. Please try again.',
          });
        } finally {
          setSavingPhoto(false);
        }
      }
    } catch (e) {
      await dialog.alert({ title: 'Error', message: 'Could not open camera or library.' });
    }
  };

  const promptPhoto = async () => {
    const idx = await dialog.actionSheet({
      title: 'Photo',
      actions: [
        { label: 'Take Photo' },
        { label: 'Choose from Library' },
        ...(photo ? [{ label: 'Remove Photo', destructive: true }] : []),
      ],
    });
    if (idx === 0) pickPhoto(true);
    else if (idx === 1) pickPhoto(false);
    else if (idx === 2) setPhoto(undefined);
  };
  const [vip, setVip] = useState(existing?.vip || false);
  const [hairType, setHairType] = useState(existing?.hair.type || 'Wavy');
  const [hairLength, setHairLength] = useState(existing?.hair.length || 'Mid-length');
  const [hairNatural, setHairNatural] = useState(existing?.hair.natural || 'Dark brown');
  const [formula, setFormula] = useState(existing?.formula || '');
  const [allergies, setAllergies] = useState(existing?.allergies === 'None on file' ? '' : existing?.allergies || '');
  const [notes, setNotes] = useState(existing?.notes || '');

  const emailError = email.trim() && !email.includes('@') ? 'Enter a valid email address' : '';
  const phoneError = phone.trim() && !/\d/.test(phone) ? 'Enter a valid phone number' : '';
  const isValid = name.trim().length > 0 && !emailError && !phoneError;

  const save = () => {
    if (!isValid) return;

    if (existing) {
      setClients((prev) => prev.map((c) => c.id === existing.id ? {
        ...c,
        name: name.trim(), phone, email, instagram: instagram.trim(), tone, photo, vip,
        hair: { type: hairType, length: hairLength, natural: hairNatural },
        formula, allergies: allergies.trim() || 'None on file', notes,
        updatedAt: Date.now(),
      } : c));
    } else {
      const newClient = createClient({
        name, phone, email, instagram: instagram.trim(), tone, photo, vip, notes, formula,
        hair: { type: hairType, length: hairLength, natural: hairNatural },
        allergies: allergies.trim(),
      });
      setClients((prev) => [...prev, newClient]);
    }
    nav.goBack();
  };

  const deleteClient = async () => {
    if (!existing) return;
    const clientAppts = appointments.filter((a) => a.clientId === existing.id);
    const completed = clientAppts.filter((a) => a.status === 'completed').length;
    const upcoming = clientAppts.filter((a) => a.status === 'upcoming').length;
    const apptNote = clientAppts.length > 0
      ? ` This also removes ${clientAppts.length} appointment${clientAppts.length === 1 ? '' : 's'} (${completed} completed, ${upcoming} upcoming).`
      : '';
    const ok = await dialog.confirm({
      title: 'Delete client',
      message: `Remove ${existing.name} permanently?${apptNote}`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    setAppointments((prev) => prev.filter((a) => a.clientId !== existing.id));
    setClients((prev) => prev.filter((c) => c.id !== existing.id));
    nav.goBack();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <RoundBtn onPress={() => nav.goBack()} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>
          {existing ? 'Edit Client' : 'New Client'}
        </Text>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, { backgroundColor: isValid ? theme.accent : theme.bg2 }]}
        >
          <Text style={[styles.saveBtnText, { color: isValid ? '#fff' : theme.ink3 }]}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Avatar preview */}
        <View style={styles.avatarRow}>
          <Pressable onPress={promptPhoto} style={styles.avatarBtn} disabled={savingPhoto}>
            <Avatar name={name || '?'} tone={tone} size={72} photo={photo} />
            <View style={[styles.avatarCamBadge, { backgroundColor: theme.accent }]}>
              <Icons.camera size={12} color="#fff" />
            </View>
            {savingPhoto && (
              <View style={styles.avatarLoading}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </Pressable>
          <View style={styles.toneRow}>
            {TONE_OPTIONS.map((t) => (
              <Pressable
                key={t}
                onPress={() => setTone(t)}
                style={[styles.toneSwatch, {
                  backgroundColor: t,
                  borderWidth: tone === t ? 3 : 0,
                  borderColor: '#fff',
                  shadowColor: t,
                  shadowOpacity: tone === t ? 0.5 : 0,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 2 },
                }]}
              />
            ))}
          </View>
        </View>

        {/* Basic info */}
        <Section label="BASIC INFO" theme={theme}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Sophie Williams" theme={theme} autoFocus />
          <Divider theme={theme} />
          <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+44 7700 900000" keyboardType="phone-pad" theme={theme} error={phoneError} />
          <Divider theme={theme} />
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="sophie@email.com" keyboardType="email-address" theme={theme} error={emailError} />
          <Divider theme={theme} />
          <Field label="Instagram" value={instagram} onChangeText={setInstagram} placeholder="@username" theme={theme} />
          <Divider theme={theme} />
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: theme.ink3, width: 'auto', flex: 1 }]}>VIP Client</Text>
            <Pressable
              onPress={() => setVip(!vip)}
              style={[styles.toggle, { backgroundColor: vip ? theme.accent : theme.bg2 }]}
            >
              <View style={[styles.toggleThumb, { transform: [{ translateX: vip ? 22 : 2 }] }]} />
            </Pressable>
          </View>
        </Section>

        {/* Hair profile */}
        <View style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: theme.ink3 }]}>HAIR PROFILE</Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <PickerRow label="Type" value={hairType} options={HAIR_TYPES} onChange={setHairType} theme={theme} />
          <Divider theme={theme} />
          <PickerRow label="Length" value={hairLength} options={HAIR_LENGTHS} onChange={setHairLength} theme={theme} />
          <Divider theme={theme} />
          <PickerRow label="Natural" value={hairNatural} options={HAIR_NATURALS} onChange={setHairNatural} theme={theme} />
        </View>

        {/* Formula */}
        <Section label="COLOUR FORMULA" theme={theme}>
          <TextInput
            style={[styles.textArea, { color: theme.ink }]}
            value={formula}
            onChangeText={setFormula}
            placeholder="e.g. Goldwell 7N + 7NB, 20vol, 1:1.5 — 35min"
            placeholderTextColor={theme.ink3}
            multiline
            numberOfLines={3}
          />
        </Section>

        {/* Allergies */}
        <Section label="ALLERGIES / SENSITIVITIES" theme={theme}>
          <TextInput
            style={[styles.textArea, { color: theme.ink }]}
            value={allergies}
            onChangeText={setAllergies}
            placeholder="None on file"
            placeholderTextColor={theme.ink3}
            multiline
          />
        </Section>

        {/* Notes */}
        <Section label="NOTES" theme={theme}>
          <TextInput
            style={[styles.textArea, { color: theme.ink }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Client preferences, personality, anything to remember…"
            placeholderTextColor={theme.ink3}
            multiline
            numberOfLines={3}
          />
        </Section>

        {/* Delete */}
        {existing && (
          <Pressable onPress={deleteClient} style={[styles.deleteBtn, { borderColor: theme.danger + '50' }]}>
            <Icons.trash size={16} color={theme.danger} />
            <Text style={[styles.deleteBtnText, { color: theme.danger }]}>Delete Client</Text>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ label, theme, children }: { label: string; theme: any; children: React.ReactNode }) {
  return (
    <>
      <View style={styles.sectionLabel}>
        <Text style={[styles.sectionLabelText, { color: theme.ink3 }]}>{label}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {children}
      </View>
    </>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType, theme, autoFocus, error }: any) {
  return (
    <View>
      <View style={styles.fieldRow}>
        <Text style={[styles.fieldLabel, { color: theme.ink3 }]}>{label}</Text>
        <TextInput
          style={[styles.fieldInput, { color: theme.ink }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.ink3}
          keyboardType={keyboardType || 'default'}
          autoFocus={autoFocus}
        />
      </View>
      {error ? <Text style={[styles.fieldError, { color: theme.danger }]}>{error}</Text> : null}
    </View>
  );
}

function PickerRow({ label, value, options, onChange, theme }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; theme: any;
}) {
  return (
    <View style={styles.pickerRow}>
      <Text style={[styles.fieldLabel, { color: theme.ink3 }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.optionChip, {
              backgroundColor: value === opt ? theme.accent : theme.bg2,
              borderColor: value === opt ? theme.accent : 'transparent',
            }]}
          >
            <Text style={[styles.optionChipText, { color: value === opt ? '#fff' : theme.ink2 }]}>{opt}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Divider({ theme }: { theme: any }) {
  return <View style={[styles.divider, { backgroundColor: theme.line }]} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', fontStyle: 'italic' },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  saveBtnText: { fontSize: 14, fontWeight: '600' },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 24 },
  avatarBtn: { position: 'relative' },
  avatarLoading: {
    position: 'absolute', width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  avatarCamBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  toneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
  toneSwatch: { width: 28, height: 28, borderRadius: 14 },

  sectionLabel: { marginBottom: 8, marginTop: 4 },
  sectionLabelText: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },

  card: {
    borderRadius: 16,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginBottom: 20,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  fieldLabel: { fontSize: 13, width: 60 },
  fieldInput: { flex: 1, fontSize: 15, fontWeight: '500', textAlign: 'right' },
  fieldError: { fontSize: 11, textAlign: 'right', paddingHorizontal: 16, paddingBottom: 10, marginTop: -4 },
  pickerRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  optionChipText: { fontSize: 12, fontWeight: '500' },
  divider: { height: 0.5, marginHorizontal: 16 },
  toggle: { width: 50, height: 28, borderRadius: 14, justifyContent: 'center' },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  textArea: {
    padding: 16,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 0.5,
    marginTop: 8,
  },
  deleteBtnText: { fontSize: 14, fontWeight: '600' },
});
