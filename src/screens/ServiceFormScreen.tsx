import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Modal, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { useDialog } from '../data/DialogContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn } from '../components';
import { numberFieldError } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ServiceForm'>;

export default function ServiceFormScreen() {
  const { theme, services, setServices, products } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const existing = route.params?.serviceId
    ? services.find((s) => s.id === route.params.serviceId) ?? null
    : null;

  const [name, setName] = useState(existing?.name || '');
  const [duration, setDuration] = useState(String(existing?.duration || '60'));
  const [price, setPrice] = useState(String(existing?.price || ''));
  const [defaults, setDefaults] = useState<string[]>(existing?.defaults || []);
  const [recommended, setRecommended] = useState<string[]>(existing?.recommended || []);
  const [productPicker, setProductPicker] = useState<'defaults' | 'recommended' | null>(null);

  const fieldErrors = {
    duration: numberFieldError(duration, { positive: true }),
    price: numberFieldError(price, { min: 0 }),
  };
  const isValid = name.trim().length > 0 && !fieldErrors.duration && !fieldErrors.price;

  const toggleInList = (list: string[], setList: (l: string[]) => void, pid: string) => {
    setList(list.includes(pid) ? list.filter((p) => p !== pid) : [...list, pid]);
  };

  const save = () => {
    if (!isValid) return;
    const svc = {
      id: existing?.id || `s-${Date.now()}`,
      name: name.trim(),
      duration: parseInt(duration) || 60,
      price: parseFloat(price) || 0,
      defaults,
      recommended,
    };
    if (existing) {
      setServices((prev) => prev.map((s) => s.id === svc.id ? svc : s));
    } else {
      setServices((prev) => [...prev, svc]);
    }
    nav.goBack();
  };

  const deleteService = async () => {
    const ok = await dialog.confirm({
      title: 'Delete service',
      message: 'Remove this service?',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    setServices((prev) => prev.filter((s) => s.id !== existing?.id));
    nav.goBack();
  };

  const activeList = productPicker === 'defaults' ? defaults : recommended;
  const setActiveList = productPicker === 'defaults'
    ? (l: string[]) => setDefaults(l)
    : (l: string[]) => setRecommended(l);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <RoundBtn onPress={() => nav.goBack()} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <Text style={[styles.headerTitle, { color: theme.ink }]}>
          {existing ? 'Edit Service' : 'New Service'}
        </Text>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, { backgroundColor: isValid ? theme.accent : theme.bg2 }]}
        >
          <Text style={[styles.saveBtnText, { color: isValid ? '#fff' : theme.ink3 }]}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Service details */}
        <SectionLabel label="SERVICE DETAILS" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <FieldRow label="Name" value={name} onChangeText={setName} placeholder="e.g. Cut + Style" theme={theme} autoFocus />
          <Divider theme={theme} />
          <FieldRow label="Duration" value={duration} onChangeText={setDuration} placeholder="60" keyboardType="number-pad" theme={theme} suffix="mins" error={fieldErrors.duration} />
          <Divider theme={theme} />
          <FieldRow label="Price" value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad" theme={theme} prefix="£" error={fieldErrors.price} />
        </View>

        {/* Default products */}
        <SectionLabel label="DEFAULT PRODUCTS" theme={theme} />
        <Text style={[styles.sectionNote, { color: theme.ink3 }]}>
          Products always added to the appointment automatically
        </Text>
        <Pressable
          onPress={() => setProductPicker('defaults')}
          style={[styles.productPickBtn, { borderColor: theme.accent + '60', backgroundColor: theme.accent + '0A' }]}
        >
          <Icons.plus size={14} color={theme.accent} />
          <Text style={[styles.productPickBtnText, { color: theme.accent }]}>
            {defaults.length ? `${defaults.length} product${defaults.length !== 1 ? 's' : ''} selected — tap to change` : 'Select products…'}
          </Text>
        </Pressable>
        {defaults.map((pid) => {
          const p = products.find((x) => x.id === pid);
          if (!p) return null;
          return (
            <View key={pid} style={[styles.selectedProduct, { backgroundColor: theme.bg2, borderColor: theme.line }]}>
              <Text style={[styles.selectedProductText, { color: theme.ink }]}>{p.name}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => setDefaults((prev) => prev.filter((x) => x !== pid))}
              >
                <Icons.close size={14} color={theme.ink3} />
              </Pressable>
            </View>
          );
        })}

        {/* Recommended products */}
        <View style={{ marginTop: 20 }}>
          <SectionLabel label="RECOMMENDED PRODUCTS" theme={theme} />
          <Text style={[styles.sectionNote, { color: theme.ink3 }]}>
            Suggested retail products to mention at checkout
          </Text>
          <Pressable
            onPress={() => setProductPicker('recommended')}
            style={[styles.productPickBtn, { borderColor: theme.line, backgroundColor: theme.card }]}
          >
            <Icons.plus size={14} color={theme.ink3} />
            <Text style={[styles.productPickBtnText, { color: recommended.length ? theme.ink : theme.ink3 }]}>
              {recommended.length ? `${recommended.length} product${recommended.length !== 1 ? 's' : ''} selected — tap to change` : 'Select products…'}
            </Text>
          </Pressable>
          {recommended.map((pid) => {
            const p = products.find((x) => x.id === pid);
            if (!p) return null;
            return (
              <View key={pid} style={[styles.selectedProduct, { backgroundColor: theme.bg2, borderColor: theme.line }]}>
                <Text style={[styles.selectedProductText, { color: theme.ink }]}>{p.name}</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => setRecommended((prev) => prev.filter((x) => x !== pid))}
                >
                  <Icons.close size={14} color={theme.ink3} />
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* Delete */}
        {existing && (
          <Pressable
            onPress={deleteService}
            style={[styles.deleteBtn, { borderColor: theme.danger + '50' }]}
          >
            <Icons.trash size={16} color={theme.danger} />
            <Text style={[styles.deleteBtnText, { color: theme.danger }]}>Delete Service</Text>
          </Pressable>
        )}
      </ScrollView>

      </KeyboardAvoidingView>

      {/* Product picker modal */}
      <Modal
        visible={productPicker !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setProductPicker(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setProductPicker(null)} />
        <View style={[styles.pickerSheet, { backgroundColor: theme.card }]}>
          <View style={styles.pickerHandle} />
          <Text style={[styles.pickerTitle, { color: theme.ink }]}>
            {productPicker === 'defaults' ? 'Default Products' : 'Recommended Products'}
          </Text>
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            style={{ maxHeight: 360 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: p }) => {
              const isSelected = activeList.includes(p.id);
              return (
                <Pressable
                  onPress={() => toggleInList(activeList, setActiveList, p.id)}
                  style={[styles.pickerRow, { borderBottomColor: theme.line }]}
                >
                  <View style={[styles.pickerCheck, {
                    backgroundColor: isSelected ? theme.accent : 'transparent',
                    borderColor: isSelected ? theme.accent : theme.ink3,
                  }]}>
                    {isSelected && <Icons.check size={12} color="#fff" />}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.pickerRowName, { color: theme.ink }]}>{p.name}</Text>
                    <Text style={[styles.pickerRowSub, { color: theme.ink3 }]}>{p.brand} · {p.stock} in stock</Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <Pressable
            onPress={() => setProductPicker(null)}
            style={[styles.pickerDone, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.pickerDoneText}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SectionLabel({ label, theme }: { label: string; theme: any }) {
  return (
    <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>{label}</Text>
  );
}

function FieldRow({ label, value, onChangeText, placeholder, keyboardType, theme, autoFocus, suffix, prefix, error }: any) {
  return (
    <View>
      <View style={styles.fieldRow}>
        <Text style={[styles.fieldLabel, { color: theme.ink3 }]}>{label}</Text>
        <View style={styles.fieldInputRow}>
          {prefix && <Text style={[styles.fieldAffix, { color: theme.ink2 }]}>{prefix}</Text>}
          <TextInput
            style={[styles.fieldInput, { color: theme.ink }]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.ink3}
            keyboardType={keyboardType || 'default'}
            autoFocus={autoFocus}
          />
          {suffix && <Text style={[styles.fieldAffix, { color: theme.ink2 }]}>{suffix}</Text>}
        </View>
      </View>
      {error ? <Text style={[styles.fieldError, { color: theme.danger }]}>{error}</Text> : null}
    </View>
  );
}

function Divider({ theme }: { theme: any }) {
  return <View style={[styles.divider, { backgroundColor: theme.line }]} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 12,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', fontStyle: 'italic' },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  saveBtnText: { fontSize: 14, fontWeight: '600' },

  sectionLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', marginBottom: 8 },
  sectionNote: { fontSize: 12, marginBottom: 10, marginTop: -4 },

  card: { borderRadius: 16, borderWidth: 0.5, overflow: 'hidden', marginBottom: 20 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  fieldLabel: { fontSize: 13, width: 64 },
  fieldInputRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  fieldInput: { fontSize: 15, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
  fieldError: { fontSize: 11, textAlign: 'right', paddingHorizontal: 16, paddingBottom: 10, marginTop: -4 },
  fieldAffix: { fontSize: 14 },
  divider: { height: 0.5, marginHorizontal: 16 },

  productPickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 13, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  productPickBtnText: { fontSize: 14, flex: 1 },
  selectedProduct: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, borderWidth: 0.5, marginBottom: 6,
  },
  selectedProductText: { fontSize: 13, fontWeight: '500' },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 14, borderRadius: 14, borderWidth: 0.5, marginTop: 24,
  },
  deleteBtnText: { fontSize: 14, fontWeight: '600' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 40 },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', alignSelf: 'center', marginBottom: 16 },
  pickerTitle: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 12, paddingHorizontal: 20 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  pickerCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pickerRowName: { fontSize: 14, fontWeight: '500' },
  pickerRowSub: { fontSize: 12, marginTop: 1 },
  pickerDone: { margin: 16, padding: 14, borderRadius: 12, alignItems: 'center' },
  pickerDoneText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
