import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Icons, useLocalDialog } from '../components';
import { Product } from '../data/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface RestockItem {
  product: Product;
  oldStock: number;
}

export default function ScanModal() {
  const { theme, products, setProducts } = useApp();
  const { confirm, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [matched, setMatched] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState(1);
  const [history, setHistory] = useState<RestockItem[]>([]);
  const [scanning, setScanning] = useState(true);

  React.useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (!scanning) return;
    setScanning(false);

    const found = products.find((p) => p.barcode === data);
    if (found) {
      setRestockQty(1);
      setMatched(found);
    } else {
      // Unknown barcode — offer to add as new product
      const add = await confirm({
        title: 'Unknown barcode',
        message: "This barcode isn't linked to any product yet. Would you like to add a new product with this barcode?",
        confirmLabel: 'Add Product',
        cancelLabel: 'Scan again',
      });
      if (add) {
        nav.goBack();
        nav.navigate('ProductForm', {});
      } else {
        setScanning(true);
      }
    }
  };

  const confirmRestock = () => {
    if (!matched) return;
    const oldStock = matched.stock;
    setProducts((prods) =>
      prods.map((p) => {
        if (p.id !== matched.id) return p;
        const newStock = p.stock + restockQty;
        return { ...p, stock: newStock, status: newStock === 0 ? 'out' : newStock <= p.reorder ? 'low' : 'ok' };
      })
    );
    setHistory((h) => [{ product: matched, oldStock }, ...h]);
    setMatched(null);
    setScanning(true);
  };

  const skip = () => {
    setMatched(null);
    setScanning(true);
  };

  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <Text style={styles.permText}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: '#0a0805' }]}>
        <Icons.barcode size={48} color="rgba(255,255,255,0.3)" />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permText}>Allow camera access to scan product barcodes for restocking.</Text>
        <Pressable onPress={requestPermission} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Allow Camera</Text>
        </Pressable>
        <Pressable onPress={() => nav.goBack()} style={styles.permCancel}>
          <Text style={styles.permCancelText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
        onBarcodeScanned={scanning ? handleBarcodeScanned : undefined}
      />

      {/* Viewfinder (absolute) */}
      <View style={styles.viewfinderWrap} pointerEvents="none">
        <View style={styles.viewfinder}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        {scanning && (
          <Text style={styles.scanHint}>Point at a product barcode</Text>
        )}
      </View>

      {/* Top bar (absolute) */}
      <View style={[styles.safeTop, { paddingTop: Math.max(insets.top, 20) }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => nav.goBack()} style={styles.closeBtn} hitSlop={20}>
            <Icons.close size={18} color="#fff" />
          </Pressable>
          <Text style={styles.topTitle}>SCAN TO RESTOCK</Text>
          <View style={{ width: 38 }} />
        </View>
      </View>

      {/* History strip */}
      {history.length > 0 && !matched && (
        <View style={styles.historyStrip}>
          <Text style={styles.historyLabel}>JUST RESTOCKED ({history.length})</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
            {history.slice(0, 4).map((h, i) => (
              <View key={i} style={styles.historyChip}>
                <Text style={styles.historyChipText} numberOfLines={1}>{h.product.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Matched product card */}
      {matched && (
        <View style={[styles.resultCard, { backgroundColor: theme.bg }]}>
          <View style={styles.resultHandle} />

          <View style={styles.matchBadge}>
            <View style={styles.matchDot} />
            <Text style={styles.matchText}>MATCH FOUND</Text>
          </View>

          <View style={styles.productRow}>
            <View style={[styles.productSwatch, { backgroundColor: theme.bg2 }]}>
              <Text style={[styles.productSwatchText, { color: theme.ink3 }]}>
                {matched.brand.slice(0, 4).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.productEyebrow, { color: theme.ink3 }]}>
                {matched.brand.toUpperCase()} · {matched.category.toUpperCase()}
              </Text>
              <Text style={[styles.productName, { color: theme.ink }]}>{matched.name}</Text>
              <Text style={[styles.productStock, { color: theme.ink2 }]}>
                {matched.stock} → <Text style={{ color: theme.sage, fontWeight: '700' }}>{matched.stock + restockQty}</Text> in stock
              </Text>
            </View>
          </View>

          <View style={styles.qtyRow}>
            <Text style={[styles.qtyLabel, { color: theme.ink3 }]}>QUANTITY TO ADD</Text>
            <View style={styles.qtyStepper}>
              <Pressable
                onPress={() => setRestockQty((q) => Math.max(1, q - 1))}
                hitSlop={8}
                style={[styles.qtyBtn, { backgroundColor: theme.bg2, borderColor: theme.line }]}
              >
                <Text style={[styles.qtyBtnText, { color: theme.ink2 }]}>−</Text>
              </Pressable>
              <Text style={[styles.qtyValue, { color: theme.ink }]}>{restockQty}</Text>
              <Pressable
                onPress={() => setRestockQty((q) => q + 1)}
                hitSlop={8}
                style={[styles.qtyBtn, { backgroundColor: theme.bg2, borderColor: theme.line }]}
              >
                <Text style={[styles.qtyBtnText, { color: theme.ink2 }]}>+</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.resultBtns}>
            <Pressable onPress={skip} style={[styles.skipBtn, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <Text style={[styles.skipBtnText, { color: theme.ink2 }]}>Skip</Text>
            </Pressable>
            <Pressable onPress={confirmRestock} style={[styles.confirmBtn, { backgroundColor: theme.accent }]}>
              <Icons.plus size={16} color="#fff" strokeWidth={2.2} />
              <Text style={styles.confirmBtnText}>Add +{restockQty} & scan another</Text>
            </Pressable>
          </View>
        </View>
      )}

      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
  permTitle: { fontSize: 20, fontWeight: '600', color: '#fff', textAlign: 'center' },
  permText: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 21 },
  permBtn: {
    marginTop: 8, backgroundColor: '#C26E4A',
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14,
  },
  permBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  permCancel: { marginTop: 4 },
  permCancelText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  safeTop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
  },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  topTitle: { fontSize: 11, letterSpacing: 1.8, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },

  viewfinderWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 40,
  },
  viewfinder: { width: 260, height: 160, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderRadius: 4, borderColor: 'rgba(255,255,255,0.9)', borderWidth: 0 },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanHint: { fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center' },

  historyStrip: {
    padding: 12, paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  historyLabel: { fontSize: 9, letterSpacing: 1.4, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  historyChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8,
  },
  historyChipText: { fontSize: 11, color: 'rgba(255,255,255,0.85)' },

  resultCard: { borderRadius: 24, padding: 20, paddingBottom: 0 },
  resultHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(42,32,26,0.2)', alignSelf: 'center', marginBottom: 16,
  },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  matchDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6B7B5C' },
  matchText: { fontSize: 10, letterSpacing: 1.4, color: '#6B7B5C', fontWeight: '700' },

  productRow: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  productSwatch: { width: 64, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  productSwatchText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  productEyebrow: { fontSize: 10, letterSpacing: 1, fontWeight: '500', marginBottom: 4 },
  productName: { fontSize: 22, fontWeight: '500', letterSpacing: -0.3, lineHeight: 26, marginBottom: 6 },
  productStock: { fontSize: 12, fontWeight: '500' },

  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  qtyLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '600' },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 20, fontWeight: '500' },
  qtyValue: { fontSize: 18, fontWeight: '700', minWidth: 32, textAlign: 'center' },

  resultBtns: { flexDirection: 'row', gap: 10, paddingBottom: 32 },
  skipBtn: {
    paddingHorizontal: 18, paddingVertical: 14,
    borderRadius: 14, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center',
  },
  skipBtnText: { fontSize: 13, fontWeight: '500' },
  confirmBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, borderRadius: 14,
  },
  confirmBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
