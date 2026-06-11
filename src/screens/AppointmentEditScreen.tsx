import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn } from '../components';
import { numberFieldError } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AppointmentEdit'>;

export default function AppointmentEditScreen() {
  const { theme, appointments, setAppointments, services } = useApp();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const appt = appointments.find((a) => a.id === route.params.appointmentId);
  if (!appt) return null;

  const [selectedService, setSelectedService] = useState(appt.service);
  const [priceInput, setPriceInput] = useState(String(appt.price));
  const [notesInput, setNotesInput] = useState(appt.notes ?? '');

  const isUpcoming = appt.status === 'upcoming';
  const priceError = numberFieldError(priceInput, { min: 0 });
  const isValid = !priceError;

  const handleSave = () => {
    if (!isValid) return;
    const svc = services.find((s) => s.name === selectedService);
    setAppointments((prev) => prev.map((a) => {
      if (a.id !== appt.id) return a;
      const next = { ...a, service: selectedService, price: parseFloat(priceInput) || a.price, notes: notesInput };
      // A different service means a different duration — recompute the end time.
      if (svc && selectedService !== appt.service) {
        next.end = new Date(new Date(a.start).getTime() + svc.duration * 60000).toISOString();
      }
      return next;
    }));
    nav.goBack();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <RoundBtn onPress={() => nav.goBack()} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>Edit Appointment</Text>
        {isUpcoming ? (
          <Pressable
            onPress={handleSave}
            disabled={!isValid}
            style={[styles.saveBtn, { backgroundColor: isValid ? theme.accent : theme.bg2 }]}
          >
            <Text style={[styles.saveBtnText, { color: isValid ? '#fff' : theme.ink3 }]}>Save</Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {!isUpcoming ? (
        <View style={styles.frozenWrap}>
          <Text style={[styles.frozenText, { color: theme.ink3 }]}>
            This appointment is {appt.status.replace('-', ' ')} and can no longer be edited.
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          {/* Service picker */}
          <Text style={[styles.label, { color: theme.ink3 }]}>SERVICE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 28 }}>
            <View style={{ flexDirection: 'row', gap: 8, paddingRight: 20 }}>
              {services.map((svc) => {
                const sel = svc.name === selectedService;
                return (
                  <Pressable
                    key={svc.id}
                    onPress={() => setSelectedService(svc.name)}
                    style={[styles.serviceChip, {
                      backgroundColor: sel ? theme.accent : theme.card,
                      borderColor: sel ? theme.accent : theme.line,
                    }]}
                  >
                    <Text style={[styles.serviceChipText, { color: sel ? '#fff' : theme.ink }]}>
                      {svc.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {/* Price field */}
          <Text style={[styles.label, { color: theme.ink3 }]}>PRICE</Text>
          <View style={[styles.inputWrap, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <Text style={[styles.currencyPrefix, { color: theme.ink2 }]}>£</Text>
            <TextInput
              style={[styles.priceInput, { color: theme.ink }]}
              value={priceInput}
              onChangeText={setPriceInput}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={theme.ink3}
            />
          </View>
          {priceError ? (
            <Text style={[styles.priceError, { color: theme.danger }]}>{priceError}</Text>
          ) : null}

          {/* Notes field */}
          <Text style={[styles.label, { color: theme.ink3, marginTop: 24 }]}>NOTES</Text>
          <TextInput
            style={[styles.notesInput, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }]}
            value={notesInput}
            onChangeText={setNotesInput}
            placeholder="Any notes for this appointment…"
            placeholderTextColor={theme.ink3}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: '500', fontStyle: 'italic' },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { fontSize: 15, fontWeight: '600' },
  priceError: { fontSize: 11, marginTop: 6 },
  frozenWrap: { flex: 1, padding: 40, alignItems: 'center', justifyContent: 'center' },
  frozenText: { fontSize: 15, textAlign: 'center', fontStyle: 'italic', lineHeight: 22 },
  label: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500', marginBottom: 12 },
  serviceChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0.5,
  },
  serviceChipText: { fontSize: 14, fontWeight: '500' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  currencyPrefix: { fontSize: 20, marginRight: 4, fontWeight: '400' },
  priceInput: { flex: 1, fontSize: 20, fontWeight: '500' },
  notesInput: {
    borderWidth: 0.5,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    lineHeight: 22,
  },
});
