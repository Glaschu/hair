import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../data/AppContext';
import { useDialog } from '../data/DialogContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, RoundBtn } from '../components';
import { numberFieldError } from '../data/utils';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ProductForm'>;

const CATEGORIES = ['Color', 'Developer', 'Lightener', 'Treatment', 'Styling', 'Shampoo', 'Conditioner', 'Other'];
const UNITS = ['ml', 'g', 'oz', 'units'];

export default function ProductFormScreen() {
  const { theme, products, setProducts, services, setServices, appointments, setAppointments, vatRate } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const existing = route.params?.productId ? products.find((p) => p.id === route.params.productId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [brand, setBrand] = useState(existing?.brand || '');
  const [category, setCategory] = useState(existing?.category || 'Color');
  const [size, setSize] = useState(String(existing?.size || ''));
  const [unit, setUnit] = useState(existing?.unit || 'ml');
  const [stock, setStock] = useState(String(existing?.stock || '0'));
  const [reorder, setReorder] = useState(String(existing?.reorder || ''));
  const [perUse, setPerUse] = useState(String(existing?.perUse || ''));
  const [cost, setCost] = useState(String(existing?.cost || ''));
  const [barcode, setBarcode] = useState(existing?.barcode || '');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();

  const fieldErrors = {
    size: numberFieldError(size, { positive: true }),
    stock: numberFieldError(stock, { min: 0 }),
    reorder: numberFieldError(reorder, { min: 0 }),
    perUse: numberFieldError(perUse, { positive: true }),
    cost: numberFieldError(cost, { min: 0 }),
  };
  const isValid = !!(name.trim() && brand.trim() && size.trim() && reorder.trim() && perUse.trim() && cost.trim())
    && !Object.values(fieldErrors).some(Boolean);

  const openScanner = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        await dialog.alert({
          title: 'Camera permission required',
          message: 'Please allow camera access to scan barcodes.',
        });
        return;
      }
    }
    setScannerOpen(true);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    // Check if this barcode is already used by another product
    const conflict = products.find((p) => p.barcode === data && p.id !== existing?.id);
    if (conflict) {
      setScannerOpen(false);
      dialog.alert({
        title: 'Barcode in use',
        message: `This barcode is already assigned to "${conflict.name}".`,
      });
      return;
    }
    setBarcode(data);
    setScannerOpen(false);
  };

  const save = () => {
    if (!isValid) return;
    const sizeNum = parseFloat(size) || 100;
    const stockNum = parseFloat(stock) || 0;
    const reorderNum = parseFloat(reorder) || 0;
    const perUseNum = parseFloat(perUse) || 0;
    const costNum = parseFloat(cost) || 0;
    const status = stockNum === 0 ? 'out' as const : stockNum <= reorderNum ? 'low' as const : 'ok' as const;

    if (existing) {
      setProducts((prev) => prev.map((p) => p.id === existing.id ? {
        ...p,
        name: name.trim(), brand: brand.trim(), category,
        size: sizeNum, unit, stock: stockNum, reorder: reorderNum,
        perUse: perUseNum, cost: costNum, status, barcode: barcode || undefined,
      } : p));
    } else {
      setProducts((prev) => [...prev, {
        id: `p-${Date.now()}`,
        name: name.trim(), brand: brand.trim(), category,
        size: sizeNum, unit, stock: stockNum, reorder: reorderNum,
        perUse: perUseNum, cost: costNum, status, barcode: barcode || undefined,
      }]);
    }
    nav.goBack();
  };

  const deleteProduct = async () => {
    if (!existing) return;
    const ok = await dialog.confirm({
      title: 'Delete product',
      message: `Remove ${existing.name}? It will also be removed from any services and appointments that use it.`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    setProducts((prev) => prev.filter((p) => p.id !== existing.id));
    setServices((prev) => prev.map((s) => ({
      ...s,
      defaults: s.defaults.filter((id) => id !== existing.id),
      recommended: s.recommended.filter((id) => id !== existing.id),
    })));
    setAppointments((prev) => prev.map((a) => ({
      ...a,
      products: a.products.filter((p) => p.productId !== existing.id),
    })));
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
          {existing ? 'Edit Product' : 'New Product'}
        </Text>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, { backgroundColor: isValid ? theme.accent : theme.bg2 }]}
        >
          <Text style={[styles.saveBtnText, { color: isValid ? '#fff' : theme.ink3 }]}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Basic info */}
        <SectionLabel label="PRODUCT INFO" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <FieldRow label="Name" value={name} onChangeText={setName} placeholder="e.g. Colorance Extra Coverage" theme={theme} autoFocus />
          <Div theme={theme} />
          <FieldRow label="Brand" value={brand} onChangeText={setBrand} placeholder="e.g. Goldwell" theme={theme} />
        </View>

        {/* Category */}
        <SectionLabel label="CATEGORY" theme={theme} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.chip, { backgroundColor: category === c ? theme.accent : theme.bg2 }]}
            >
              <Text style={[styles.chipText, { color: category === c ? '#fff' : theme.ink2 }]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Size & unit */}
        <SectionLabel label="SIZE & UNIT" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <FieldRow label="Size" value={size} onChangeText={setSize} placeholder="100" keyboardType="decimal-pad" theme={theme} error={fieldErrors.size} />
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <View style={{ flex: 1 }}>
              <View style={styles.unitRow}>
                {UNITS.map((u) => (
                  <Pressable
                    key={u}
                    onPress={() => setUnit(u)}
                    style={[styles.unitChip, {
                      backgroundColor: unit === u ? theme.accent : theme.bg2,
                    }]}
                  >
                    <Text style={[styles.unitChipText, { color: unit === u ? '#fff' : theme.ink2 }]}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Stock levels */}
        <SectionLabel label="STOCK LEVELS" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <FieldRow label="Current stock" value={stock} onChangeText={setStock} placeholder="0" keyboardType="decimal-pad" theme={theme} error={fieldErrors.stock} />
          <Div theme={theme} />
          <FieldRow label="Reorder at" value={reorder} onChangeText={setReorder} placeholder="e.g. 2" keyboardType="decimal-pad" theme={theme} error={fieldErrors.reorder} />
          <Div theme={theme} />
          <FieldRow label="Per use" value={perUse} onChangeText={setPerUse} placeholder={`e.g. 50${unit}`} keyboardType="decimal-pad" theme={theme} error={fieldErrors.perUse} />
        </View>

        {/* Cost */}
        <SectionLabel label="COST" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <FieldRow label="Unit cost (£)" value={cost} onChangeText={setCost} placeholder="e.g. 12.50" keyboardType="decimal-pad" theme={theme} error={fieldErrors.cost} />
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <Pressable
            onPress={() => {
              const current = parseFloat(cost) || 0;
              if (current > 0) {
                const withVat = current * (1 + vatRate / 100);
                setCost(withVat.toFixed(2));
              }
            }}
            style={({ pressed }) => [{ padding: 12, alignItems: 'center', backgroundColor: pressed ? theme.bg2 : 'transparent' }]}
          >
            <Text style={{ fontSize: 13, fontWeight: '500', color: theme.accent }}>+ Add {vatRate}% VAT</Text>
          </Pressable>
        </View>

        {/* Barcode */}
        <SectionLabel label="BARCODE" theme={theme} />
        <Pressable
          onPress={openScanner}
          style={[styles.barcodeCard, {
            backgroundColor: theme.card,
            borderColor: barcode ? theme.accent + '60' : theme.line,
          }]}
        >
          <View style={[styles.barcodeIcon, { backgroundColor: barcode ? theme.accent + '15' : theme.bg2 }]}>
            <Icons.barcode size={22} color={barcode ? theme.accent : theme.ink3} />
          </View>
          <View style={{ flex: 1 }}>
            {barcode ? (
              <>
                <Text style={[styles.barcodeValue, { color: theme.ink }]}>{barcode}</Text>
                <Text style={[styles.barcodeSub, { color: theme.sage }]}>Barcode saved — tap to re-scan</Text>
              </>
            ) : (
              <>
                <Text style={[styles.barcodeTitle, { color: theme.ink }]}>Scan barcode</Text>
                <Text style={[styles.barcodeSub, { color: theme.ink3 }]}>Tap to use camera — enables quick restocking</Text>
              </>
            )}
          </View>
          {barcode && (
            <Pressable onPress={() => setBarcode('')} hitSlop={10}>
              <Icons.close size={16} color={theme.ink3} />
            </Pressable>
          )}
        </Pressable>

        {/* Delete */}
        {existing && (
          <Pressable onPress={deleteProduct} style={[styles.deleteBtn, { borderColor: theme.danger + '50' }]}>
            <Icons.trash size={16} color={theme.danger} />
            <Text style={[styles.deleteBtnText, { color: theme.danger }]}>Delete Product</Text>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Barcode scanner modal */}
      <Modal visible={scannerOpen} animationType="slide">
        <View style={styles.scanContainer}>
          <SafeAreaView edges={['top']} style={{ backgroundColor: 'transparent' }}>
            <View style={styles.scanTopBar}>
              <Pressable onPress={() => setScannerOpen(false)} style={styles.scanCloseBtn}>
                <Icons.close size={18} color="#fff" />
              </Pressable>
              <Text style={styles.scanTitle}>SCAN PRODUCT BARCODE</Text>
              <View style={{ width: 38 }} />
            </View>
          </SafeAreaView>

          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={handleBarcodeScanned}
          >
            {/* Viewfinder overlay */}
            <View style={styles.scanOverlay}>
              <View style={styles.scanViewfinder}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.scanHint}>Point camera at the barcode on the product</Text>
            </View>
          </CameraView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SectionLabel({ label, theme }: { label: string; theme: any }) {
  return (
    <View style={styles.sectionLabelWrap}>
      <Text style={[styles.sectionLabelText, { color: theme.ink3 }]}>{label}</Text>
    </View>
  );
}

function FieldRow({ label, value, onChangeText, placeholder, keyboardType, theme, autoFocus, error }: any) {
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

function Div({ theme }: { theme: any }) {
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

  card: { borderRadius: 16, borderWidth: 0.5, overflow: 'hidden', marginBottom: 20 },
  sectionLabelWrap: { marginBottom: 8, marginTop: 4 },
  sectionLabelText: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500' },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  fieldLabel: { fontSize: 13, width: 90 },
  fieldInput: { flex: 1, fontSize: 15, fontWeight: '500', textAlign: 'right' },
  fieldError: { fontSize: 11, textAlign: 'right', paddingHorizontal: 16, paddingBottom: 10, marginTop: -4 },
  divider: { height: 0.5, marginHorizontal: 16 },

  chipRow: { gap: 8, paddingBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '500' },

  row: { flexDirection: 'row' },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  unitChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  unitChipText: { fontSize: 12, fontWeight: '600' },

  barcodeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, borderWidth: 0.5, padding: 16, marginBottom: 20,
  },
  barcodeIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  barcodeTitle: { fontSize: 15, fontWeight: '600' },
  barcodeValue: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  barcodeSub: { fontSize: 12, marginTop: 1 },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 14, borderRadius: 14, borderWidth: 0.5, marginTop: 8,
  },
  deleteBtnText: { fontSize: 14, fontWeight: '600' },

  // Scanner
  scanContainer: { flex: 1, backgroundColor: '#000' },
  scanTopBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, paddingTop: 14,
  },
  scanCloseBtn: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  scanTitle: { fontSize: 11, letterSpacing: 1.6, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40 },
  scanViewfinder: { width: 260, height: 160, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderRadius: 4, borderColor: '#fff', borderWidth: 0 },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanHint: { fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center', paddingHorizontal: 40 },
});
