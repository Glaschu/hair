import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Modal, FlatList, StyleSheet, Linking, Platform, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Icons, RoundBtn, useLocalDialog, ProductPicker, ProductUseRow, PhotoStrip, usePhotoAdd } from '../components';
import { fmt } from '../data/utils';
import { useVisitActions } from '../data/useVisitActions';
import { webBookingIdOf } from '../data/webCancels';
import { previewWebCancel } from '../data/bookingApi';
import { describeFailure, type Failure } from '../data/serviceErrors';
import { depositMoney } from '../data/policy';
import { loadCredentials } from '../data/bookingStore';
import { Appointment, Product } from '../data/types';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AppointmentDetail'>;

export default function AppointmentDetailScreen() {
  const {
    theme, appointments, setAppointments, clients, setClients, products, services,
    backend, cancelWebBooking, withdrawWebCancel,
  } = useApp();
  const { confirm, alert, actionSheet, dialog } = useLocalDialog();
  const visit = useVisitActions();
  const addPhotos = usePhotoAdd({ actionSheet, alert });
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');
  const priceEditRef = useRef({ editing: false, draft: '' });
  priceEditRef.current = { editing: editingPrice, draft: priceDraft };
  const [markPaid, setMarkPaid] = useState(true);

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

  const addApptPhotos = async () => {
    if (!client) return;
    await addPhotos({ clientId: client.id, appointmentId: apptId });
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
    visit.complete(appt, { paid: markPaid });
    setConfirmOpen(false);
  };

  /**
   * Cancelling. For an appointment made in the app, as before. For one that
   * came in online, the booking service has to be told — to give the hour back
   * and, where a deposit was taken, to refund it — and when a deposit is held,
   * how much goes back depends on who is cancelling, which only she knows.
   */
  const handleCancel = async () => {
    const bookingId = webBookingIdOf(appt.id);
    // Linked is what matters, not whether the online-booking buttons are
    // switched on: a booking that came in online is on the service either way,
    // and hiding the buttons must not stop the service hearing she cancelled.
    if (!bookingId || !backend.has('booking-links')) {
      visit.markCancelled(appt);
      return;
    }

    const who = client?.name?.trim().split(/\s+/)[0] ?? 'this';
    const title = who === 'this' ? 'Cancel this appointment?' : `Cancel ${who}'s appointment?`;
    let refund: 'full' | 'policy' | null = null;


    // Why the service could not be asked, when it could not. Not always the
    // signal: a sign-in that has lapsed holds the cancellation here until she
    // signs in again, and she has to be told that, not that she is offline.
    let failure = null as Failure | null;

    if (backend.has('deposits')) {
      const creds = await loadCredentials().catch(() => null);
      // undefined: could not ask. null: this service takes no deposits.
      const preview = creds
        ? await previewWebCancel(creds, bookingId).catch((e) => {
          failure = describeFailure(e, '');
          return undefined;
        })
        : undefined;

      if (preview && preview.depositMinor > 0) {
        // In pounds, exactly: what the service charged and will refund.
        const deposit = depositMoney(preview.depositMinor);
        const backMinor = Math.round(preview.depositMinor * preview.policyRefundPct / 100);
        const idx = await actionSheet({
          title,
          message: `They paid a ${deposit} deposit when they booked. How much goes back?`,
          actions: [
            { label: `I'm cancelling: refund all ${deposit}` },
            { label: backMinor > 0
              ? `They asked: refund ${depositMoney(backMinor)} (your policy)`
              : 'They asked: no refund at this notice (your policy)' },
          ],
          cancelLabel: 'Keep the appointment',
        });
        if (idx === null) return;
        refund = idx === 0 ? 'full' : 'policy';
      } else if (preview === undefined) {
        // Could not ask: the amounts cannot be checked, but the choice can
        // still be made — it is sent, with the time she made it, once the
        // service can be reached.
        const why = failure;
        const idx = await actionSheet({
          title,
          message: why && !why.offline
            ? `If they paid a deposit, how much goes back? The amounts can't be shown: ${why.message} Your choice is kept and sent once that's done.`
            : "If they paid a deposit, how much goes back? You're offline, so the amounts can't be shown — your booking page is updated as soon as you're back.",
          actions: [
            { label: "I'm cancelling: refund the deposit in full" },
            { label: 'They asked: use my cancellation policy' },
          ],
          cancelLabel: 'Keep the appointment',
        });
        if (idx === null) return;
        refund = idx === 0 ? 'full' : 'policy';
      }
    }

    if (!refund) {
      const ok = await confirm({
        title,
        message: 'They booked online, so their booking is cancelled on your booking page too, and the time is free to offer to someone else.',
        confirmLabel: 'Cancel appointment',
        cancelLabel: 'Keep it',
        tone: 'destructive',
      });
      if (!ok) return;
      // No deposit is held, so nothing is refunded either way.
      refund = 'full';
    }

    visit.markCancelled(appt);
    const { reached } = await cancelWebBooking(appt.id, refund);
    if (!reached) {
      const why = failure;
      await alert({
        title: 'Cancelled here',
        message: why && !why.offline
          ? `Your booking page will be updated, and any refund sent, once this is sorted: ${why.message}`
          : "Your booking page will be updated, and any refund sent, as soon as you're back online.",
      });
    }
  };

  const handleNoShow = () => {
    visit.markNoShow(appt);
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

  const handleUndo = async () => {
    if (isCancelled) {
      const was = withdrawWebCancel(appt.id);
      // Still waiting to be sent: taken back, so the service never cancels it
      // or refunds anything. Nothing more to say.
      if (was === 'unknown') {
        // This device never sent a cancellation for it. The client may have
        // cancelled from their link, or her other device may have — or the
        // service may still hold it. Only what is known is said.
        const ok = await confirm({
          title: 'Put it back in your diary?',
          message:
            'This booking came in online. If it was cancelled on your booking page — by the client, or from your ' +
            "other device — putting it back only changes your diary: the client won't see it. " +
            'To book them in properly, send them a new link.',
          confirmLabel: 'Put it back',
          cancelLabel: 'Leave it cancelled',
        });
        if (!ok) return;
      }
      if (was === 'sent') {
        const ok = await confirm({
          title: 'Put it back in your diary?',
          message:
            'This booking is already cancelled on your booking page: any deposit is being refunded, and ' +
            "their link no longer works. Putting it back only changes your diary — the client won't see it. " +
            'To book them in properly, send them a new link.',
          confirmLabel: 'Put it back anyway',
          cancelLabel: 'Leave it cancelled',
        });
        if (!ok) return;
      }
    }
    visit.undoComplete(appt);
  };

  const statusColor = isNoShow ? theme.danger : isCompleted ? theme.sage : isCancelled ? theme.ink3 : theme.accent;
  const statusBg = isNoShow ? theme.danger + '20' : isCompleted ? theme.sage + '20' : isCancelled ? theme.ink3 + '15' : theme.accent + '15';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      {/*
        No KeyboardAvoidingView here on purpose. This screen is a page sheet
        on iPad, and KAV measures its own frame against the window — inside a
        sheet that maths is wrong, so it over-pads and pushes the lower half
        of the form out of reach exactly when the keyboard is up. UIKit does
        the same job correctly from inside the scroll view, sheet geometry
        included.
      */}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
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

        {/* Visit record — the structured wrap-up fields, once completed */}
        {isCompleted && (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.sectionEye, { color: theme.ink3, marginBottom: 0 }]}>VISIT RECORD</Text>
              <Pressable
                onPress={() => nav.navigate('VisitWrapUp', { appointmentId: apptId })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.accent + '15', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }}
              >
                <Icons.clipboardCheck size={16} color={theme.accent} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent }}>
                  {appt.technique || appt.timing || appt.nextNotes ? 'Edit visit notes' : 'Add visit notes'}
                </Text>
              </Pressable>
            </View>
            {(appt.technique || appt.timing || appt.nextNotes) ? (
              <View style={[styles.notesCard, { backgroundColor: theme.card, borderColor: theme.line, padding: 14, gap: 10 }]}>
                {!!appt.technique && (
                  <View>
                    <Text style={[styles.recordLabel, { color: theme.ink3 }]}>TECHNIQUE</Text>
                    <Text style={[styles.recordValue, { color: theme.ink }]}>{appt.technique}</Text>
                  </View>
                )}
                {!!appt.timing && (
                  <View>
                    <Text style={[styles.recordLabel, { color: theme.ink3 }]}>PROCESSING</Text>
                    <Text style={[styles.recordValue, { color: theme.ink }]}>{appt.timing}</Text>
                  </View>
                )}
                {!!appt.nextNotes && (
                  <View>
                    <Text style={[styles.recordLabel, { color: theme.accent }]}>NEXT TIME</Text>
                    <Text style={[styles.recordValue, { color: theme.ink }]}>{appt.nextNotes}</Text>
                  </View>
                )}
              </View>
            ) : (
              <Text style={{ fontSize: 13, fontStyle: 'italic', color: theme.ink3 }}>
                Technique, processing, and the plan for next time.
              </Text>
            )}
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
            <Pressable onPress={addApptPhotos} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.accent + '15', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }}>
              <Icons.camera size={16} color={theme.accent} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent }}>Add photo</Text>
            </Pressable>
          </View>
          <PhotoStrip
            photos={client?.photos?.filter(p => p.appointmentId === apptId) ?? []}
            emptyText="No photos for this appointment."
          />
        </View>
      </ScrollView>

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
  recordLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.1, marginBottom: 3 },
  recordValue: { fontSize: 14, lineHeight: 20 },
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
});
