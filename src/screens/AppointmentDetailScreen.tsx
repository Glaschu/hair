import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Modal, FlatList, StyleSheet, Linking, Platform, Image, KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Icons, RoundBtn, useLocalDialog, ProductPicker } from '../components';
import { fmt } from '../data/utils';
import { deductStock, restoreStock } from '../data/stock';
import { notifyLowStock } from '../data/notifications';
import { savePhoto, deletePhoto, getPhotoUri } from '../db/photos';
import { Appointment, Product, ClientPhoto } from '../data/types';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AppointmentDetail'>;

export default function AppointmentDetailScreen() {
  const { theme, appointments, setAppointments, clients, setClients, products, setProducts, services } = useApp();
  const { confirm, alert, actionSheet, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');
  const priceEditRef = useRef({ editing: false, draft: '' });
  priceEditRef.current = { editing: editingPrice, draft: priceDraft };
  const [markPaid, setMarkPaid] = useState(true);
  const [viewingPhoto, setViewingPhoto] = useState<ClientPhoto | null>(null);

  const apptId = route.params.appointmentId;
  const appt = appointments.find((a) => a.id === apptId);

  if (!appt) return null;

  const client = clients.find((c) => c.id === appt.clientId);
  const isCompleted = appt.status === 'completed';
  const isCancelled = appt.status === 'cancelled';
  const isNoShow = appt.status === 'no-show';
  const clientVisits = appointments.filter((a) => a.clientId === appt.clientId && a.status === 'completed').length;

  const usedProducts = appt.products
    .map((up) => ({ ...up, product: products.find((p) => p.id === up.productId) }))
    .filter((up): up is typeof up & { product: Product } => up.product !== undefined);

  const totalCost = usedProducts.reduce((s, up) => {
    return s + (up.product.cost * (up.amount / up.product.size));
  }, 0);

  const addPhotos = async () => {
    if (!client) return;
    const action = await actionSheet({
      title: 'Add Photo',
      actions: [{ label: 'Take Photo' }, { label: 'Choose from Library' }]
    });
    if (action === null) return;
    
    let result: ImagePicker.ImagePickerResult;
    try {
      if (action === 0) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          await alert({ title: 'Permission Denied', message: 'Camera access is required to take photos.' });
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          await alert({ title: 'Permission Denied', message: 'Photo library access is required to choose photos.' });
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          allowsMultipleSelection: true, quality: 0.8,
          mediaTypes: ['images'],
        });
      }
    } catch (e) {
      console.log("ImagePicker Error:", e);
      await alert({ title: 'Error', message: 'Could not open the camera or library on this device.' });
      return;
    }

    if (!result.canceled) {
      try {
        const saved = await Promise.all(result.assets.map(a => savePhoto(a.uri)));
        const newPhotos: ClientPhoto[] = saved.map((uri) => ({
          id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: new Date().toISOString(),
          url: uri,
          label: '',
          appointmentId: apptId,
        }));
        setClients((cs) => cs.map((c) => c.id === client.id
          ? { ...c, photos: [...newPhotos, ...(c.photos || [])] }
          : c));
      } catch {
        // failed
      }
    }
  };

  const updateNotes = (text: string) => {
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, notes: text } : a));
  };

  const updateFormula = (text: string) => {
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, formula: text } : a));
  };

  const updateProductAmount = (productId: string, amount: number) => {
    setAppointments((prev) => prev.map((a) => {
      if (a.id !== apptId) return a;
      return { ...a, products: a.products.map((p) => p.productId === productId ? { ...p, amount } : p) };
    }));
  };

  const removeProduct = (productId: string) => {
    setAppointments((prev) => prev.map((a) => {
      if (a.id !== apptId) return a;
      return { ...a, products: a.products.filter((p) => p.productId !== productId) };
    }));
  };

  const addProduct = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setAppointments((prev) => prev.map((a) => {
      if (a.id !== apptId) return a;
      if (a.products.some((x) => x.productId === productId)) return a;
      return { ...a, products: [...a.products, { productId, amount: p.perUse }] };
    }));
    setPickerOpen(false);
  };

  const handleComplete = () => {
    if (appt.status !== 'upcoming') {
      setConfirmOpen(false);
      return;
    }
    usedProducts.forEach((up) => {
      const after = deductStock(up.product, up.amount);
      if (after.status !== 'ok' && after.status !== up.product.status) {
        notifyLowStock(up.product.name, after.status === 'out');
      }
    });
    setProducts((prods) =>
      prods.map((p) => {
        const used = usedProducts.find((up) => up.productId === p.id);
        return used ? deductStock(p, used.amount) : p;
      })
    );
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'completed', paid: markPaid } : a));
    setConfirmOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCancel = () => {
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'cancelled' } : a));
  };

  const handleNoShow = () => {
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'no-show' } : a));
  };

  const commitPrice = () => {
    const n = parseFloat(priceDraft);
    if (Number.isFinite(n) && n >= 0) {
      setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, price: n } : a));
    }
    setEditingPrice(false);
  };

  // The decimal-pad keyboard has no return key and navigating back unmounts
  // the screen without firing onBlur, so commit any pending edit on unmount.
  useEffect(() => () => {
    const { editing, draft } = priceEditRef.current;
    if (!editing) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n >= 0) {
      setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, price: n } : a));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUndo = () => {
    if (isCompleted) {
      setProducts((prods) =>
        prods.map((p) => {
          const used = usedProducts.find((up) => up.productId === p.id);
          return used ? restoreStock(p, used.amount) : p;
        })
      );
    }
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status: 'upcoming' } : a));
  };

  const statusColor = isNoShow ? theme.danger : isCompleted ? theme.sage : isCancelled ? theme.ink3 : theme.accent;
  const statusBg = isNoShow ? theme.danger + '20' : isCompleted ? theme.sage + '20' : isCancelled ? theme.ink3 + '15' : theme.accent + '15';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Top bar */}
        <View style={styles.topBar}>
          <RoundBtn label="Back" onPress={() => nav.goBack()} size={38}>
            <Icons.chevronLeft size={18} color={theme.ink} />
          </RoundBtn>
          <View style={{ width: 38 }} />
        </View>

        {/* Status badge */}
        <View style={{ paddingHorizontal: 20, marginBottom: 10 }}>
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{appt.status.replace('-', ' ').toUpperCase()}</Text>
          </View>
        </View>

        {/* Header */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={[styles.dateEyebrow, { color: theme.ink3 }]}>
            {fmt.rel(appt.start).toUpperCase()} · {fmt.timeShort(appt.start)} – {fmt.timeShort(appt.end)}
          </Text>
          <Text style={[styles.serviceTitle, { color: theme.ink }]}>{appt.service}</Text>
        </View>

        {/* Quick actions */}
        {appt.status === 'upcoming' && (
          <View style={styles.quickActions}>
            <Pressable
              onPress={() => nav.navigate('RescheduleModal', { appointmentId: apptId })}
              style={[styles.quickActionBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
            >
              <Icons.clock size={14} color={theme.accent} />
              <Text style={[styles.quickActionText, { color: theme.ink }]}>Reschedule</Text>
            </Pressable>
            <Pressable
              onPress={() => nav.navigate('AppointmentEdit', { appointmentId: apptId })}
              style={[styles.quickActionBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
            >
              <Icons.edit size={14} color={theme.accent} />
              <Text style={[styles.quickActionText, { color: theme.ink }]}>Edit details</Text>
            </Pressable>
          </View>
        )}

        {/* Client card */}
        {client && (
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <Pressable
              onPress={() => nav.navigate('ClientDetail', { clientId: client.id })}
              style={({ pressed }) => [
                styles.clientCard,
                { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Avatar name={client.name} tone={client.tone} size={48} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.clientName, { color: theme.ink }]}>{client.name}</Text>
                <Text style={[styles.clientSub, { color: theme.ink2 }]}>
                  {clientVisits} visits · {client.phone}
                </Text>
              </View>
              <Icons.chevronRight size={14} color={theme.ink3} />
            </Pressable>
            {!!client.phone && (
              <View style={styles.contactRow}>
                <Pressable
                  onPress={() => Linking.openURL(`tel:${client.phone}`)}
                  style={[styles.contactBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
                >
                  <Icons.phone size={15} color={theme.accent} />
                  <Text style={[styles.contactBtnText, { color: theme.ink }]}>Call</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const dateStr = fmt.day(appt.start);
                    const timeStr = fmt.timeShort(appt.start);
                    const msg = `Hi ${client.name}, just a quick reminder of your upcoming appointment for ${appt.service} on ${dateStr} at ${timeStr}. See you soon!`;
                    const separator = Platform.OS === 'ios' ? '&' : '?';
                    Linking.openURL(`sms:${client.phone}${separator}body=${encodeURIComponent(msg)}`);
                  }}
                  style={[styles.contactBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
                >
                  <Icons.message size={15} color={theme.accent} />
                  <Text style={[styles.contactBtnText, { color: theme.ink }]}>Text</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* At the chair — allergies */}
        {client && client.allergies && client.allergies !== 'None on file' && (
          <View style={{ paddingHorizontal: 20, marginBottom: 16, gap: 10 }}>
            <View style={[styles.allergyBanner, { backgroundColor: theme.warn + '18', borderColor: theme.warn }]}>
              <Icons.alert size={14} color={theme.warn} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.allergyLabel, { color: theme.warn }]}>ALLERGIES & SENSITIVITIES</Text>
                <Text style={[styles.allergyText, { color: theme.ink }]}>{client.allergies}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Formula */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 8 }]}>COLOR FORMULA</Text>
          <View style={[styles.notesCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <TextInput
              style={[styles.notesInput, { color: theme.ink }]}
              value={appt.formula || ''}
              onChangeText={updateFormula}
              placeholder="e.g. 30g 6N + 30g 20vol..."
              placeholderTextColor={theme.ink3}
              multiline
            />
          </View>
        </View>

        {/* Products section */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View style={styles.productsSectionHead}>
            <View>
              <Text style={[styles.sectionEye, { color: theme.ink3 }]}>{isCompleted ? 'USED' : 'PLANNED'}</Text>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>Products</Text>
            </View>
            {!isCompleted && !isCancelled && !isNoShow && (
              <Pressable onPress={() => setPickerOpen(true)} style={styles.addProductBtn}>
                <Icons.plus size={14} color={theme.accent} strokeWidth={2} />
                <Text style={[styles.addProductText, { color: theme.accent }]}>Add</Text>
              </Pressable>
            )}
          </View>

          {usedProducts.length === 0 ? (
            <View style={[styles.emptyProducts, { borderColor: theme.line }]}>
              <Text style={[styles.emptyText, { color: theme.ink3 }]}>No products on this appointment</Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {usedProducts.map((up) => (
                <ProductUseRow
                  key={up.productId}
                  product={up.product}
                  amount={up.amount}
                  editable={!isCompleted && !isCancelled && !isNoShow}
                  onChangeAmount={(a) => updateProductAmount(up.productId, a)}
                  onRemove={() => removeProduct(up.productId)}
                  theme={theme}
                />
              ))}
            </View>
          )}

          {usedProducts.length > 0 && (
            <View style={[styles.costRow, { backgroundColor: theme.bg2 }]}>
              <Text style={[styles.costLabel, { color: theme.ink3 }]}>PRODUCT COST</Text>
              <Text style={[styles.costVal, { color: theme.ink }]}>{fmt.currency(totalCost, 2)}</Text>
            </View>
          )}
        </View>

        {/* Service price */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <Pressable
            onPress={() => {
              if (appt.status === 'upcoming' && !editingPrice) {
                setPriceDraft(String(appt.price));
                setEditingPrice(true);
              }
            }}
            style={[styles.priceCard, { backgroundColor: theme.heroBg }]}
          >
            <Text style={styles.priceLabel}>
              SERVICE PRICE{appt.status === 'upcoming' && !editingPrice ? '  ·  TAP TO EDIT' : ''}
            </Text>
            {editingPrice ? (
              <View style={styles.priceEditRow}>
                <Text style={styles.priceVal}>£</Text>
                <TextInput
                  style={[styles.priceVal, styles.priceInput]}
                  value={priceDraft}
                  onChangeText={setPriceDraft}
                  keyboardType="decimal-pad"
                  autoFocus
                  onBlur={commitPrice}
                  onSubmitEditing={commitPrice}
                />
              </View>
            ) : (
              <Text style={styles.priceVal}>{fmt.currency(appt.price)}</Text>
            )}
          </Pressable>
        </View>

        {/* Payment */}
        {isCompleted && (
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <Pressable
              onPress={() => setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, paid: !a.paid } : a))}
              style={[styles.paidControl, {
                backgroundColor: appt.paid ? theme.sage + '20' : theme.warn + '18',
                borderColor: appt.paid ? theme.sage : theme.warn,
              }]}
            >
              <Text style={[styles.paidControlText, { color: appt.paid ? theme.sage : theme.warn }]}>
                {appt.paid ? '✓  PAID' : 'UNPAID — tap to mark paid'}
              </Text>
            </Pressable>
          </View>
        )}


        {/* Notes */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 8 }]}>NOTES</Text>
          <View style={[styles.notesCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <TextInput
              style={[styles.notesInput, { color: theme.ink }]}
              value={appt.notes || ''}
              onChangeText={updateNotes}
              placeholder="Anything to remember about this visit…"
              placeholderTextColor={theme.ink3}
              multiline
            />
          </View>
        </View>

        {/* Photos */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 0 }]}>PHOTOS</Text>
            <Pressable onPress={addPhotos} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.accent + '15', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }}>
              <Icons.camera size={16} color={theme.accent} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent }}>Add photo</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {client?.photos?.filter(p => p.appointmentId === apptId).map(p => (
              <Pressable key={p.id} onPress={() => setViewingPhoto(p)} style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden' }}>
                <Image source={{ uri: getPhotoUri(p.url) }} style={{ flex: 1 }} resizeMode="cover" />
              </Pressable>
            ))}
            {(!client?.photos || client.photos.filter(p => p.appointmentId === apptId).length === 0) && (
              <Text style={{ fontSize: 13, fontStyle: 'italic', color: theme.ink3 }}>No photos for this appointment.</Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Photo viewer modal */}
      {viewingPhoto && (
        <Modal visible animationType="fade" onRequestClose={() => setViewingPhoto(null)}>
          <Pressable style={styles.photoViewer} onPress={() => setViewingPhoto(null)}>
            <Image source={{ uri: getPhotoUri(viewingPhoto.url) }} style={styles.photoViewerImg} resizeMode="contain" />
            <Text style={styles.photoViewerDate}>{fmt.rel(viewingPhoto.date)}</Text>
          </Pressable>
        </Modal>
      )}

      {dialog}

      {/* Action buttons */}
      <View style={[styles.actionWrap, { backgroundColor: theme.bg }]}>
        {!isCompleted && !isCancelled && !isNoShow && (
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleCancel}
              style={[styles.cancelBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
            >
              <Text style={[styles.cancelBtnText, { color: theme.ink2 }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleNoShow}
              style={[styles.noShowBtn, { backgroundColor: theme.danger + '15', borderColor: theme.danger + '40' }]}
            >
              <Text style={[styles.cancelBtnText, { color: theme.danger }]}>No show</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmOpen(true)}
              style={[styles.completeBtn, { backgroundColor: theme.accent }]}
            >
              <Icons.check size={16} color="#fff" strokeWidth={2.2} />
              <Text style={styles.completeBtnText}>Complete</Text>
            </Pressable>
          </View>
        )}
        {(isCompleted || isCancelled || isNoShow) && (
          <Pressable
            onPress={handleUndo}
            style={[styles.undoBtn, { backgroundColor: theme.card, borderColor: theme.line }]}
          >
            <Text style={[styles.undoBtnText, { color: theme.ink }]}>
              {isCompleted ? 'Undo completion · restore stock' : `Undo ${isCancelled ? 'cancel' : 'no-show'}`}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Product picker modal */}
      <ProductPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => {
          if (typeof id === 'string') addProduct(id);
        }}
        excludeIds={appt.products.map(p => p.productId)}
      />

      {/* Completion confirm modal */}
      <Modal visible={confirmOpen} animationType="slide" transparent>
        <View style={styles.sheetOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setConfirmOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: theme.ink }]}>Complete & deduct stock</Text>
            <Text style={[styles.sheetDesc, { color: theme.ink2 }]}>
              Marking this complete will deduct the following from your stock:
            </Text>
            <View style={{ gap: 8, marginBottom: 24 }}>
              {usedProducts.map((up) => {
                const newStock = Math.max(0, up.product.stock - (up.amount / up.product.size));
                const willBeLow = newStock <= up.product.reorder;
                return (
                  <View key={up.productId} style={[styles.deductRow, { backgroundColor: theme.bg2 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.deductName, { color: theme.ink }]}>{up.product.name}</Text>
                      <Text style={[styles.deductAmt, { color: theme.ink2 }]}>−{up.amount}{up.product.unit}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.deductStock, { color: willBeLow ? theme.warn : theme.ink }]}>
                        {up.product.stock} → {newStock.toFixed(1)}
                      </Text>
                      {willBeLow && <Text style={[styles.deductWarn, { color: theme.warn }]}>LOW</Text>}
                    </View>
                  </View>
                );
              })}
              {usedProducts.length === 0 && (
                <Text style={[styles.emptyText, { color: theme.ink3, textAlign: 'center', paddingVertical: 20 }]}>
                  No stock to deduct
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => setMarkPaid((v) => !v)}
              style={[styles.paidToggleRow, { backgroundColor: theme.bg2 }]}
            >
              <Text style={[styles.paidToggleLabel, { color: theme.ink }]}>Client has paid</Text>
              <View style={[styles.toggleTrack, { backgroundColor: markPaid ? theme.sage : theme.line }]}>
                <View style={[styles.toggleThumb, { transform: [{ translateX: markPaid ? 20 : 2 }] }]} />
              </View>
            </Pressable>
            <Pressable
              onPress={handleComplete}
              style={[styles.confirmCompleteBtn, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.confirmCompleteBtnText}>Confirm & complete</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function ProductUseRow({
  product, amount, editable, onChangeAmount, onRemove, theme,
}: {
  product: Product;
  amount: number;
  editable: boolean;
  onChangeAmount: (a: number) => void;
  onRemove: () => void;
  theme: any;
}) {
  return (
    <View style={[styles.productUseRow, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={[styles.productUseSwatch, { backgroundColor: theme.bg2 }]}>
        <Text style={[styles.productUseSwatchText, { color: theme.ink3 }]}>
          {product.brand.slice(0, 3).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.productUseName, { color: theme.ink }]} numberOfLines={1}>{product.name}</Text>
        <Text style={[styles.productUseBrand, { color: theme.ink2 }]}>{product.brand}</Text>
      </View>
      {editable ? (
        <View style={styles.amtControl}>
          <Pressable
            onPress={() => onChangeAmount(Math.max(0, amount - 5))}
            hitSlop={8}
            style={({ pressed }) => [styles.amtBtn, { borderColor: theme.line, backgroundColor: theme.bg2, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.amtBtnText, { color: theme.ink2 }]}>−</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 48 }}>
            <TextInput
              style={[styles.amtText, { color: theme.ink, padding: 0, minWidth: 0 }]}
              value={amount.toString()}
              onChangeText={(t) => {
                const n = parseFloat(t);
                onChangeAmount(isNaN(n) ? 0 : n);
              }}
              keyboardType="numeric"
            />
            <Text style={[styles.amtText, { color: theme.ink, padding: 0, minWidth: 0 }]}>{product.unit}</Text>
          </View>
          <Pressable
            onPress={() => onChangeAmount(amount + 5)}
            hitSlop={8}
            style={({ pressed }) => [styles.amtBtn, { borderColor: theme.line, backgroundColor: theme.bg2, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.amtBtnText, { color: theme.ink2 }]}>+</Text>
          </Pressable>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => [{ padding: 4, marginLeft: 2, opacity: pressed ? 0.5 : 1 }]}
          >
            <Icons.close size={14} color={theme.ink3} />
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.amtText, { color: theme.ink }]}>{amount}{product.unit}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },

  dateEyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '500', marginBottom: 6 },
  serviceTitle: { fontSize: 30, fontFamily: SERIF, letterSpacing: -0.5, lineHeight: 34 },

  clientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 14,
  },
  clientName: { fontSize: 15, fontWeight: '600' },
  clientSub: { fontSize: 11, marginTop: 2 },

  productsSectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionEye: { fontSize: 10, letterSpacing: 1.4, fontWeight: '400', marginBottom: 2 },
  allergyBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 0.5,
  },
  allergyLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', marginBottom: 3 },
  allergyText: { fontSize: 13, lineHeight: 18 },
  formulaCard: { borderRadius: 12, borderWidth: 0.5, padding: 14 },
  formulaText: { fontFamily: 'DMMono_400Regular', fontSize: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 20, fontFamily: SERIF, letterSpacing: -0.3 },
  addProductBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 2 },
  addProductText: { fontSize: 13, fontWeight: '500' },

  emptyProducts: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, fontStyle: 'italic' },

  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  costLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '500' },
  costVal: { fontSize: 18, fontWeight: '500' },

  priceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 16,
    padding: 18,
  },
  priceLabel: { fontSize: 10, letterSpacing: 1.2, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
  priceVal: { fontSize: 32, fontWeight: '500', color: '#fff', letterSpacing: -0.5 },
  priceEditRow: { flexDirection: 'row', alignItems: 'center' },
  priceInput: { minWidth: 120, padding: 0 },
  quickActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  quickActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 0.5,
  },
  quickActionText: { fontSize: 13, fontWeight: '600' },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  contactBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 0.5,
  },
  contactBtnText: { fontSize: 13, fontWeight: '600' },

  notesCard: {
    borderRadius: 14,
    borderWidth: 0.5,
  },
  notesText: { padding: 14, fontSize: 15, lineHeight: 22, minHeight: 60 },
  notesInput: {
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 70,
    textAlignVertical: 'top',
  },

  // Action area
  actionWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 32 },
  actionRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '500' },
  noShowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  completeBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  undoBtn: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 0.5,
    alignItems: 'center',
  },
  undoBtnText: { fontSize: 13, fontWeight: '500' },

  // Product use row
  productUseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  productUseSwatch: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productUseSwatchText: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  productUseName: { fontSize: 13, fontWeight: '600' },
  productUseBrand: { fontSize: 11, marginTop: 1 },
  amtControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amtBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amtBtnText: { fontSize: 20, fontWeight: '500', lineHeight: 24 },
  amtText: { fontSize: 13, fontWeight: '600', minWidth: 48, textAlign: 'center' },

  // Sheets
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '80%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontFamily: SERIF, marginBottom: 8 },
  sheetDesc: { fontSize: 13, lineHeight: 19, marginBottom: 18 },

  // Picker
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  pickerSwatch: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pickerSwatchText: { fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  pickerName: { fontSize: 13, fontWeight: '600' },
  pickerBrand: { fontSize: 11, marginTop: 1 },
  pickerUnit: { fontSize: 11, fontWeight: '500' },

  // Deduct rows
  deductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
  },
  deductName: { fontSize: 13, fontWeight: '500' },
  deductAmt: { fontSize: 11, marginTop: 2 },
  deductStock: { fontSize: 11, fontWeight: '600' },
  deductWarn: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 2 },
  confirmCompleteBtn: {
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  confirmCompleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  paidToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, marginBottom: 10,
  },
  paidToggleLabel: { fontSize: 14, fontWeight: '500' },
  toggleTrack: { width: 44, height: 26, borderRadius: 13, justifyContent: 'center' },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  paidControl: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12, borderWidth: 0.5,
  },
  paidControlText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  photoViewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  photoViewerImg: { width: '100%', flex: 1, borderRadius: 12 },
  photoViewerDate: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 12 },
});
