import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import {
  Avatar, Icons, useLocalDialog, ProductPicker, ProductUseRow, PhotoStrip, usePhotoAdd,
} from '../components';
import { fmt } from '../data/utils';
import { clientVisitContext, adjustCompletedUsage } from '../data/visits';
import { Appointment } from '../data/types';
import { SERIF, typography } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'VisitWrapUp'>;

/**
 * The visit record — the classic colourist record card, kept fast. Every
 * field writes straight through to the appointment as you type; "Done"
 * just closes. Opened from a completed appointment ("Add visit notes").
 */
export default function VisitWrapUpScreen() {
  const { theme, appointments, setAppointments, clients, products, setProducts } = useApp();
  const { alert, actionSheet, dialog } = useLocalDialog();
  const addPhotos = usePhotoAdd({ actionSheet, alert });
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const apptId = route.params.appointmentId;
  const appt = appointments.find((a) => a.id === apptId);
  const client = appt ? clients.find((c) => c.id === appt.clientId) : undefined;
  if (!appt || !client) return null;

  const isCompleted = appt.status === 'completed';
  const ctx = clientVisitContext(client.id, appointments, client, { excludeAppointmentId: apptId });
  const apptPhotos = client.photos?.filter((p) => p.appointmentId === apptId) ?? [];

  const update = (patch: Partial<Appointment>) => {
    setAppointments((prev) => prev.map((a) => (a.id === apptId ? { ...a, ...patch } : a)));
  };

  // Product edits after completion keep stock truthful: restore the old
  // deduction, apply the new one.
  const changeAmount = (productId: string, newAmount: number) => {
    const old = appt.products.find((p) => p.productId === productId)?.amount ?? 0;
    if (isCompleted) setProducts((prev) => adjustCompletedUsage(prev, productId, old, newAmount));
    setAppointments((prev) => prev.map((a) => a.id === apptId
      ? { ...a, products: a.products.map((p) => (p.productId === productId ? { ...p, amount: newAmount } : p)) }
      : a));
  };

  const removeProduct = (productId: string) => {
    const old = appt.products.find((p) => p.productId === productId)?.amount ?? 0;
    if (isCompleted) setProducts((prev) => adjustCompletedUsage(prev, productId, old, 0));
    setAppointments((prev) => prev.map((a) => a.id === apptId
      ? { ...a, products: a.products.filter((p) => p.productId !== productId) }
      : a));
  };

  const addProduct = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p || appt.products.some((x) => x.productId === productId)) {
      setPickerOpen(false);
      return;
    }
    if (isCompleted) setProducts((prev) => adjustCompletedUsage(prev, productId, 0, p.perUse));
    setAppointments((prev) => prev.map((a) => a.id === apptId
      ? { ...a, products: [...a.products, { productId, amount: p.perUse }] }
      : a));
    setPickerOpen(false);
  };

  const usedProducts = appt.products
    .map((ap) => ({ ...ap, product: products.find((p) => p.id === ap.productId) }))
    .filter((up): up is typeof up & { product: NonNullable<typeof up.product> } => !!up.product);

  const field = (label: string, node: React.ReactNode, hint?: React.ReactNode) => (
    <View style={{ marginBottom: 18 }}>
      <Text style={[styles.fieldLabel, { color: theme.ink3 }]}>{label}</Text>
      {node}
      {hint}
    </View>
  );

  const inputStyle = [styles.input, { backgroundColor: theme.card, borderColor: theme.line, color: theme.ink }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.headerEyebrow, { color: theme.ink3 }]}>
              VISIT RECORD · {fmt.rel(appt.start).toUpperCase()}
            </Text>
            <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={1}>
              {client.name} <Text style={{ color: theme.ink3 }}>· {appt.service}</Text>
            </Text>
          </View>
          <Pressable
            onPress={() => nav.goBack()}
            style={[styles.doneBtn, { backgroundColor: theme.accent }]}
            accessibilityRole="button"
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>

        {/*
          No KeyboardAvoidingView here on purpose. This screen is a page sheet
          on iPad, and KAV measures its own frame against the window — inside a
          sheet that maths is wrong, so it over-pads and pushes the lower half
          of the form out of reach exactly when the keyboard is up. UIKit does
          the same job correctly from inside the scroll view, sheet geometry
          included.
        */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {field('FORMULA',
            <TextInput
              style={[...inputStyle, typography.mono(13), { lineHeight: 20 }]}
              value={appt.formula ?? ''}
              onChangeText={(t) => update({ formula: t })}
              placeholder="e.g. 30g 6N + 30g 20vol..."
              placeholderTextColor={theme.ink3}
              multiline
            />,
            !appt.formula && ctx.effectiveFormula ? (
              <Pressable onPress={() => update({ formula: ctx.effectiveFormula })} style={{ marginTop: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }} numberOfLines={2}>
                  Use last visit's formula → {ctx.effectiveFormula}
                </Text>
              </Pressable>
            ) : undefined,
          )}

          {field('TECHNIQUE',
            <TextInput
              style={inputStyle}
              value={appt.technique ?? ''}
              onChangeText={(t) => update({ technique: t })}
              placeholder="e.g. balayage, foils on top section"
              placeholderTextColor={theme.ink3}
            />,
          )}

          {field('PROCESSING',
            <TextInput
              style={inputStyle}
              value={appt.timing ?? ''}
              onChangeText={(t) => update({ timing: t })}
              placeholder="e.g. 35 min @ 20vol"
              placeholderTextColor={theme.ink3}
            />,
          )}

          {field('NEXT TIME',
            <TextInput
              style={[...inputStyle, { minHeight: 72 }]}
              value={appt.nextNotes ?? ''}
              onChangeText={(t) => update({ nextNotes: t })}
              placeholder="Plan for the next visit — this shows chair-side when they're back."
              placeholderTextColor={theme.ink3}
              multiline
            />,
          )}

          {field('NOTES',
            <TextInput
              style={[...inputStyle, { minHeight: 72 }]}
              value={appt.notes ?? ''}
              onChangeText={(t) => update({ notes: t })}
              placeholder="Anything to remember about this visit…"
              placeholderTextColor={theme.ink3}
              multiline
            />,
          )}

          {/* Products used */}
          <View style={{ marginBottom: 18 }}>
            <View style={styles.rowBetween}>
              <Text style={[styles.fieldLabel, { color: theme.ink3, marginBottom: 0 }]}>PRODUCTS USED</Text>
              <Pressable onPress={() => setPickerOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icons.plus size={13} color={theme.accent} strokeWidth={2} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }}>Add</Text>
              </Pressable>
            </View>
            <View style={{ gap: 8, marginTop: 8 }}>
              {usedProducts.map((up) => (
                <ProductUseRow
                  key={up.productId}
                  product={up.product}
                  amount={up.amount}
                  editable
                  onChangeAmount={(a) => changeAmount(up.productId, a)}
                  onRemove={() => removeProduct(up.productId)}
                />
              ))}
              {usedProducts.length === 0 && (
                <Text style={{ fontSize: 13, fontStyle: 'italic', color: theme.ink3 }}>
                  No products recorded for this visit.
                </Text>
              )}
            </View>
            {isCompleted && usedProducts.length > 0 && (
              <Text style={{ fontSize: 11, color: theme.ink3, marginTop: 8 }}>
                Changes here adjust your stock levels.
              </Text>
            )}
          </View>

          {/* Photos */}
          <View style={{ marginBottom: 18 }}>
            <View style={styles.rowBetween}>
              <Text style={[styles.fieldLabel, { color: theme.ink3, marginBottom: 0 }]}>PHOTOS</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['Before', 'After'] as const).map((label) => (
                  <Pressable
                    key={label}
                    onPress={() => addPhotos({ clientId: client.id, appointmentId: apptId, label })}
                    style={[styles.photoBtn, { backgroundColor: theme.accent + '15' }]}
                  >
                    <Icons.camera size={14} color={theme.accent} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={{ marginTop: 10 }}>
              <PhotoStrip photos={apptPhotos} emptyText="No photos for this visit yet." />
            </View>
          </View>

          {/* Chair-side context for reference */}
          {client.allergies && client.allergies !== 'None on file' ? (
            <View style={[styles.allergyStrip, { backgroundColor: theme.warn + '18' }]}>
              <Icons.alert size={13} color={theme.warn} />
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: theme.ink, flex: 1 }}>
                {client.allergies}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <ProductPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(id) => {
            if (typeof id === 'string') addProduct(id);
          }}
          excludeIds={appt.products.map((p) => p.productId)}
        />

        {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
  },
  headerEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  headerTitle: { fontSize: 24, fontFamily: SERIF, marginTop: 2 },
  doneBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  doneBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  input: {
    borderWidth: 0.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 44,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
  },
  allergyStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
});
