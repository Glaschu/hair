import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Card, Icons, RoundBtn, StatusBadge, CustomTimeRow, ProductPicker, useLocalDialog } from '../components';
import { Client, Service, Product } from '../data/types';
import { fmt, isSameDay, addDays, checkSchedule, fmtHHMM, DAY_NAMES, generateTimeSlots, createClient, clientMatchesQuery } from '../data/utils';
import { hasConflict } from '../data/booking';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'NewAppointment'>;

type Step = 'client' | 'service' | 'time' | 'products' | 'review';

const STEPS: Step[] = ['client', 'service', 'time', 'products', 'review'];
const STEP_LABELS = ['Client', 'Service', 'Time', 'Products', 'Review'];

const REPEAT_OPTIONS: { weeks: number; label: string }[] = [
  { weeks: 0, label: 'Off' },
  { weeks: 2, label: 'Every 2 wks' },
  { weeks: 3, label: 'Every 3 wks' },
  { weeks: 4, label: 'Every 4 wks' },
  { weeks: 6, label: 'Every 6 wks' },
];

export default function NewAppointmentScreen() {
  const { theme, clients, setClients, services, products, appointments, setAppointments, schedule, bookingWindowDays } = useApp();
  const { alert, confirm, actionSheet, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();

  // When "Book" is used from a client profile, the client's usual service is passed
  // through so the booking can jump straight to picking a time.
  const prefillSvc = route.params?.prefillService
    ? services.find((s) => s.name === route.params.prefillService) ?? null
    : null;

  const [step, setStep] = useState<Step>(
    prefillSvc ? 'time' : route.params?.clientId ? 'service' : 'client',
  );
  const [selectedClient, setSelectedClient] = useState<Client | null>(
    route.params?.clientId ? clients.find((c) => c.id === route.params.clientId) || null : null
  );
  const [selectedService, setSelectedService] = useState<Service | null>(prefillSvc);
  const [selectedDate, setSelectedDate] = useState(route.params?.date ? new Date(route.params.date) : new Date());
  const [selectedTime, setSelectedTime] = useState<{ h: number; m: number }>({ h: 10, m: 0 });
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    prefillSvc ? [...prefillSvc.defaults] : []
  );
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showCustomTime, setShowCustomTime] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [repeatTimes, setRepeatTimes] = useState(4);
  const scrollRef = React.useRef<ScrollView>(null);

  React.useEffect(() => {
    if (step === 'time' && scrollRef.current) {
      const idx = Array.from({ length: bookingWindowDays }, (_, i) => addDays(new Date(), i))
        .findIndex(d => isSameDay(d, selectedDate));
      if (idx > 0) {
        setTimeout(() => {
          scrollRef.current?.scrollTo({ x: Math.max(0, idx * 56 - 60), animated: true });
        }, 50);
      }
    }
  }, [step]);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [clientQuery, setClientQuery] = useState('');

  const matchedClients = useMemo(
    () => clients.filter((c) => clientMatchesQuery(c, clientQuery)),
    [clients, clientQuery],
  );

  const currentStepIdx = STEPS.indexOf(step);

  const goNext = () => {
    const next = STEPS[currentStepIdx + 1];
    if (next) setStep(next);
  };

  const goBack = () => {
    if (currentStepIdx === 0) { nav.goBack(); return; }
    setStep(STEPS[currentStepIdx - 1]);
  };

  const scheduleCheck = useMemo(() => {
    const d = new Date(selectedDate);
    d.setHours(selectedTime.h, selectedTime.m, 0, 0);
    return checkSchedule(schedule, d, selectedService?.duration ?? 60);
  }, [schedule, selectedDate, selectedTime, selectedService]);

  const timeSlots = useMemo(
    () => generateTimeSlots(schedule, selectedDate),
    [schedule, selectedDate],
  );

  const takenSlots = useMemo(() => {
    return appointments
      .filter((a) => isSameDay(new Date(a.start), selectedDate) && a.status !== 'cancelled')
      .map((a) => ({ start: new Date(a.start), end: new Date(a.end) }));
  }, [appointments, selectedDate]);

  const isSlotTaken = (h: number, m: number) => {
    if (!selectedService) return false;
    const start = new Date(selectedDate);
    start.setHours(h, m, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + selectedService.duration);
    return hasConflict(start, end, takenSlots);
  };

  const addNewClient = () => {
    if (!newClientName.trim()) return;
    const c = createClient({ name: newClientName, phone: newClientPhone });
    setClients((prev) => [...prev, c]);
    setSelectedClient(c);
    setShowNewClient(false);
    goNext();
  };

  const handleServiceSelect = (svc: Service) => {
    setSelectedService(svc);
    setSelectedProducts([...svc.defaults]);
  };

  const toggleProduct = (pid: string) => {
    setSelectedProducts((prev) =>
      prev.includes(pid) ? prev.filter((p) => p !== pid) : [...prev, pid]
    );
  };

  const submit = async () => {
    if (!selectedClient || !selectedService) return;
    const client = selectedClient;
    const service = selectedService;
    const start = new Date(selectedDate);
    start.setHours(selectedTime.h, selectedTime.m, 0, 0);
    if (start.getTime() < Date.now()) {
      await alert({
        title: 'Time is in the past',
        message: 'Pick a time later than now for this booking.',
      });
      return;
    }

    const count = repeatWeeks > 0 ? repeatTimes : 1;
    const baseId = Date.now();
    const products_ = selectedProducts.map((pid) => {
      const p = products.find((pr) => pr.id === pid);
      return { productId: pid, amount: p?.perUse || 0 };
    });
    
    const lastCompleted = appointments
      .filter((a) => a.clientId === client.id && a.status === 'completed')
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())[0];
    const defaultFormula = lastCompleted?.formula || client.formula || undefined;

    const series = Array.from({ length: count }, (_, i) => {
      const s = new Date(start);
      s.setDate(s.getDate() + i * repeatWeeks * 7);
      const e = new Date(s);
      e.setMinutes(e.getMinutes() + service.duration);
      return {
        id: `a-${baseId}-${i}`,
        clientId: client.id,
        start: s.toISOString(),
        end: e.toISOString(),
        service: service.name,
        status: 'upcoming' as const,
        price: service.price,
        products: products_.map((p) => ({ ...p })),
        notes: notes.trim() || undefined,
        formula: defaultFormula,
      };
    });

    setAppointments((prev) => [...prev, ...series]);
    setConfirmed(true);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {confirmed ? (
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
          <View style={styles.confirmedWrap}>
            <View style={[styles.confirmedCircle, { backgroundColor: theme.sage + '20' }]}>
              <Icons.check size={40} color={theme.sage} />
            </View>
            <Text style={[styles.confirmedTitle, { color: theme.ink }]}>Booked!</Text>
            <Text style={[styles.confirmedSub, { color: theme.ink2 }]}>
              {selectedClient?.name} · {selectedService?.name}{'\n'}
              {repeatWeeks > 0
                ? `${repeatTimes} visits · every ${repeatWeeks} weeks`
                : `${fmt.rel(selectedDate.toISOString())} at ${selectedTime.h % 12 || 12}:${selectedTime.m.toString().padStart(2, '0')}${selectedTime.h >= 12 ? 'pm' : 'am'}`}
            </Text>
            <Pressable
              style={[styles.doneBtn, { backgroundColor: theme.accent }]}
              onPress={() => nav.goBack()}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : (
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <RoundBtn onPress={goBack} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: theme.ink }]}>New Appointment</Text>
        </View>
        <Pressable onPress={() => nav.goBack()}>
          <Icons.close size={20} color={theme.ink3} />
        </Pressable>
      </View>

      {/* Step progress */}
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <View style={[styles.progressDot, {
              backgroundColor: i <= currentStepIdx ? theme.accent : theme.bg2,
              borderColor: i === currentStepIdx ? theme.accent : 'transparent',
            }]}>
              {i < currentStepIdx && <Icons.check size={10} color="#fff" />}
            </View>
            {i < STEPS.length - 1 && (
              <View style={[styles.progressLine, { backgroundColor: i < currentStepIdx ? theme.accent : theme.bg2 }]} />
            )}
          </React.Fragment>
        ))}
      </View>
      <Text style={[styles.stepLabel, { color: theme.ink3 }]}>
        Step {currentStepIdx + 1} — {STEP_LABELS[currentStepIdx]}
      </Text>

      <View style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Step 1: Client */}
        {step === 'client' && (
          <View style={{ padding: 20 }}>
            <Text style={[styles.stepTitle, { color: theme.ink }]}>Select Client</Text>

            <View style={[styles.searchWrap, { backgroundColor: theme.bg2 }]}>
              <Icons.search size={16} color={theme.ink3} />
              <TextInput
                style={[styles.searchInput, { color: theme.ink }]}
                placeholder="Search name or phone…"
                placeholderTextColor={theme.ink3}
                value={clientQuery}
                onChangeText={setClientQuery}
                returnKeyType="search"
              />
            </View>

            {showNewClient ? (
              <View style={[styles.newClientCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
                <TextInput
                  style={[styles.newClientInput, { color: theme.ink, borderColor: theme.line }]}
                  placeholder="Client name"
                  placeholderTextColor={theme.ink3}
                  value={newClientName}
                  onChangeText={setNewClientName}
                  autoFocus
                />
                <TextInput
                  style={[styles.newClientInput, { color: theme.ink, borderColor: theme.line }]}
                  placeholder="Phone (optional)"
                  placeholderTextColor={theme.ink3}
                  value={newClientPhone}
                  onChangeText={setNewClientPhone}
                  keyboardType="phone-pad"
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => setShowNewClient(false)}
                    style={[styles.newClientCancel, { borderColor: theme.line }]}
                  >
                    <Text style={{ color: theme.ink2, fontWeight: '600' }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={addNewClient}
                    disabled={!newClientName.trim()}
                    style={[styles.newClientAdd, { backgroundColor: newClientName.trim() ? theme.accent : theme.bg2 }]}
                  >
                    <Text style={{ color: newClientName.trim() ? '#fff' : theme.ink3, fontWeight: '600' }}>
                      Add & continue
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setShowNewClient(true)}
                style={[styles.newClientToggle, { borderColor: theme.accent }]}
              >
                <Icons.plus size={16} color={theme.accent} />
                <Text style={[styles.newClientToggleText, { color: theme.accent }]}>New client</Text>
              </Pressable>
            )}

            {matchedClients.map((client) => (
              <Pressable
                key={client.id}
                onPress={() => { setSelectedClient(client); goNext(); }}
                style={({ pressed }) => [styles.selectRow, {
                  backgroundColor: pressed ? theme.bg2 : theme.card,
                  borderColor: theme.line,
                }]}
              >
                <Avatar name={client.name} tone={client.tone} size={40} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.selectName, { color: theme.ink }]}>{client.name}</Text>
                  <Text style={[styles.selectSub, { color: theme.ink3 }]}>
                    {appointments.filter((a) => a.clientId === client.id && a.status === 'completed').length} visits
                  </Text>
                </View>
                <Icons.chevronRight size={16} color={theme.ink3} />
              </Pressable>
            ))}
            {matchedClients.length === 0 && clientQuery.trim() !== '' && (
              <Text style={[styles.noMatch, { color: theme.ink3 }]}>
                No clients match “{clientQuery.trim()}”
              </Text>
            )}
          </View>
        )}

        {/* Step 2: Service */}
        {step === 'service' && (
          <View style={{ padding: 20 }}>
            <Text style={[styles.stepTitle, { color: theme.ink }]}>Select Service</Text>
            {services.map((svc) => (
              <Pressable
                key={svc.id}
                onPress={() => { handleServiceSelect(svc); goNext(); }}
                style={({ pressed }) => [styles.selectRow, {
                  backgroundColor: pressed ? theme.bg2 : theme.card,
                  borderColor: selectedService?.id === svc.id ? theme.accent : theme.line,
                }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.selectName, { color: theme.ink }]}>{svc.name}</Text>
                  <Text style={[styles.selectSub, { color: theme.ink3 }]}>
                    {fmt.duration(svc.duration)} · {fmt.currency(svc.price)}
                  </Text>
                </View>
                <Icons.chevronRight size={16} color={theme.ink3} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Step 3: Time */}
        {step === 'time' && (
          <View style={{ padding: 20 }}>
            <Text style={[styles.stepTitle, { color: theme.ink }]}>Pick a Time</Text>

            {/* Date strip */}
            <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {Array.from({ length: bookingWindowDays }, (_, i) => addDays(new Date(), i)).map((day, i, arr) => {
                  const isSelected = isSameDay(day, selectedDate);
                  const showMonth = i === 0 || day.getMonth() !== arr[i - 1].getMonth();
                  return (
                    <React.Fragment key={day.toISOString()}>
                      {showMonth && (
                        <View style={styles.monthDivider}>
                          <Text style={[styles.monthDividerText, { color: theme.ink3 }]}>
                            {day.toLocaleDateString('en-GB', { month: 'long' })}
                          </Text>
                        </View>
                      )}
                      <Pressable
                        onPress={() => setSelectedDate(day)}
                        style={[styles.datePill, {
                          backgroundColor: isSelected ? theme.accent : theme.bg2,
                        }]}
                      >
                        <Text style={[styles.datePillDay, { color: isSelected ? '#fff' : theme.ink3 }]}>
                          {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                        </Text>
                        <Text style={[styles.datePillNum, { color: isSelected ? '#fff' : theme.ink }]}>
                          {day.getDate()}
                        </Text>
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </View>
            </ScrollView>

            {/* Time grid */}
            <View style={styles.timeGrid}>
              {timeSlots.map(({ h, m }) => {
                const taken = isSlotTaken(h, m);
                const selected = selectedTime.h === h && selectedTime.m === m;
                const label = `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
                return (
                  <Pressable
                    key={`${h}${m}`}
                    onPress={() => !taken && setSelectedTime({ h, m })}
                    style={[styles.timeSlot, {
                      backgroundColor: taken ? theme.bg2 : selected ? theme.accent : theme.card,
                      borderColor: selected ? theme.accent : taken ? 'transparent' : theme.line,
                      opacity: taken ? 0.4 : 1,
                    }]}
                    disabled={taken}
                  >
                    <Text style={[styles.timeSlotText, {
                      color: selected ? '#fff' : taken ? theme.ink3 : theme.ink,
                    }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Custom time */}
            <Pressable onPress={() => setShowCustomTime((v) => !v)} style={styles.customToggle}>
              <Text style={[styles.customToggleText, { color: theme.accent }]}>
                {showCustomTime ? '− Hide custom time' : '+ Custom time'}
              </Text>
            </Pressable>
            {showCustomTime && <CustomTimeRow value={selectedTime} onChange={setSelectedTime} />}

            {/* Schedule warning */}
            {(scheduleCheck.dayClosed || scheduleCheck.offHours) && (
              <View style={[styles.schedWarn, { backgroundColor: theme.warn + '18', borderColor: theme.warn }]}>
                <Icons.alert size={14} color={theme.warn} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.schedWarnTitle, { color: theme.ink }]}>
                    {scheduleCheck.dayClosed ? 'Booking on a day off' : 'Outside working hours'}
                  </Text>
                  <Text style={[styles.schedWarnSub, { color: theme.ink2 }]}>
                    {scheduleCheck.dayClosed
                      ? `${DAY_NAMES[selectedDate.getDay()]} is marked as closed.`
                      : scheduleCheck.day
                        ? `${DAY_NAMES[selectedDate.getDay()]} runs ${fmtHHMM(scheduleCheck.day.start)}–${fmtHHMM(scheduleCheck.day.end)}`
                        : ''}
                  </Text>
                </View>
              </View>
            )}

            <Pressable
              style={[styles.nextBtn, { backgroundColor: theme.accent }]}
              onPress={goNext}
            >
              <Text style={styles.nextBtnText}>Continue</Text>
              <Icons.arrowRight size={18} color="#fff" />
            </Pressable>
          </View>
        )}

        {/* Step 4: Products */}
        {step === 'products' && selectedService && (
          <View style={{ padding: 20 }}>
            <Text style={[styles.stepTitle, { color: theme.ink }]}>Products</Text>

            {selectedService.defaults.length > 0 && (
              <>
                <Text style={[styles.productGroupLabel, { color: theme.ink3 }]}>DEFAULT</Text>
                {selectedService.defaults.map((pid) => {
                  const p = products.find((pr) => pr.id === pid);
                  if (!p) return null;
                  return <ProductToggleRow key={pid} product={p} selected={selectedProducts.includes(pid)} onToggle={() => toggleProduct(pid)} />;
                })}
              </>
            )}

            {selectedService.recommended.length > 0 && (
              <>
                <Text style={[styles.productGroupLabel, { color: theme.ink3, marginTop: 16 }]}>RECOMMENDED</Text>
                {selectedService.recommended.map((pid) => {
                  const p = products.find((pr) => pr.id === pid);
                  if (!p) return null;
                  return <ProductToggleRow key={pid} product={p} selected={selectedProducts.includes(pid)} onToggle={() => toggleProduct(pid)} />;
                })}
              </>
            )}

            {/* Extra products added via picker (not in defaults/recommended) */}
            {selectedProducts.filter((pid) =>
              !selectedService.defaults.includes(pid) && !selectedService.recommended.includes(pid)
            ).length > 0 && (
              <>
                <Text style={[styles.productGroupLabel, { color: theme.ink3, marginTop: 16 }]}>ADDED</Text>
                {selectedProducts
                  .filter((pid) => !selectedService.defaults.includes(pid) && !selectedService.recommended.includes(pid))
                  .map((pid) => {
                    const p = products.find((pr) => pr.id === pid);
                    if (!p) return null;
                    return <ProductToggleRow key={pid} product={p} selected onToggle={() => toggleProduct(pid)} />;
                  })}
              </>
            )}

            <Pressable
              onPress={() => setShowProductPicker(true)}
              style={[styles.addProductBtn, { borderColor: theme.accent }]}
            >
              <Icons.plus size={16} color={theme.accent} />
              <Text style={[styles.addProductBtnText, { color: theme.accent }]}>Add any product</Text>
            </Pressable>

            <TextInput
              style={[styles.notesInput, { borderColor: theme.line, color: theme.ink }]}
              placeholder="Notes (optional)..."
              placeholderTextColor={theme.ink3}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />

            <Pressable
              style={[styles.nextBtn, { backgroundColor: theme.accent }]}
              onPress={goNext}
            >
              <Text style={styles.nextBtnText}>Review</Text>
              <Icons.arrowRight size={18} color="#fff" />
            </Pressable>

            <ProductPicker
              visible={showProductPicker}
              onClose={() => setShowProductPicker(false)}
              onSelect={(ids) => {
                if (Array.isArray(ids)) {
                  setSelectedProducts(ids);
                }
              }}
              initialSelectedIds={selectedProducts}
              mode="multiple"
            />
          </View>
        )}

        {/* Step 5: Review */}
        {step === 'review' && selectedClient && selectedService && (
          <View style={{ padding: 20 }}>
            <Text style={[styles.stepTitle, { color: theme.ink }]}>Review & Confirm</Text>

            {/* Schedule warning on review */}
            {(scheduleCheck.dayClosed || scheduleCheck.offHours) && (
              <View style={[styles.schedWarn, { backgroundColor: theme.warn + '18', borderColor: theme.warn, marginBottom: 16 }]}>
                <Icons.alert size={14} color={theme.warn} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.schedWarnTitle, { color: theme.ink }]}>
                    {scheduleCheck.dayClosed ? 'Booking on a day off' : 'Outside working hours'}
                  </Text>
                  <Text style={[styles.schedWarnSub, { color: theme.ink2 }]}>
                    {scheduleCheck.dayClosed
                      ? `${DAY_NAMES[selectedDate.getDay()]} is marked closed. You can still proceed.`
                      : scheduleCheck.day
                        ? `${DAY_NAMES[selectedDate.getDay()]} runs ${fmtHHMM(scheduleCheck.day.start)}–${fmtHHMM(scheduleCheck.day.end)}. You can still proceed.`
                        : ''}
                  </Text>
                </View>
              </View>
            )}

            <Card style={{ marginBottom: 16 }}>
              <ReviewRow icon={<Icons.users size={16} color={theme.accent} />} label="Client" value={selectedClient.name} theme={theme} />
              <ReviewRow icon={<Icons.scissors size={16} color={theme.accent} />} label="Service" value={selectedService.name} theme={theme} />
              <ReviewRow icon={<Icons.clock size={16} color={theme.accent} />} label="Time" value={`${fmt.rel(selectedDate.toISOString())} at ${selectedTime.h % 12 || 12}:${selectedTime.m.toString().padStart(2, '0')}${selectedTime.h >= 12 ? 'pm' : 'am'}`} theme={theme} />
              <ReviewRow icon={<Icons.clock size={16} color={theme.accent} />} label="Duration" value={fmt.duration(selectedService.duration)} theme={theme} />
              <ReviewRow icon={<Icons.trend size={16} color={theme.accent} />} label="Price" value={fmt.currency(selectedService.price)} theme={theme} />
            </Card>

            {selectedProducts.length > 0 && (
              <Card style={{ marginBottom: 16 }}>
                <Text style={[styles.reviewGroupLabel, { color: theme.ink3 }]}>PRODUCTS</Text>
                {selectedProducts.map((pid) => {
                  const p = products.find((pr) => pr.id === pid);
                  if (!p) return null;
                  const isLow = p.status === 'low' || p.status === 'out';
                  return (
                    <View key={pid} style={styles.reviewProduct}>
                      <Text style={[styles.reviewProductName, { color: theme.ink }]}>{p.name}</Text>
                      {isLow && <StatusBadge status={p.status} />}
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Repeat */}
            <Card style={{ marginBottom: 16 }}>
              <Text style={[styles.reviewGroupLabel, { color: theme.ink3 }]}>REPEAT</Text>
              <View style={styles.repeatRow}>
                {REPEAT_OPTIONS.map((opt) => {
                  const active = repeatWeeks === opt.weeks;
                  return (
                    <Pressable
                      key={opt.weeks}
                      onPress={() => setRepeatWeeks(opt.weeks)}
                      style={[styles.repeatChip, { backgroundColor: active ? theme.accent : theme.bg2 }]}
                    >
                      <Text style={[styles.repeatChipText, { color: active ? '#fff' : theme.ink2 }]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {repeatWeeks > 0 && (
                <>
                  <Text style={[styles.reviewGroupLabel, { color: theme.ink3, marginTop: 14 }]}>HOW MANY VISITS</Text>
                  <View style={styles.repeatRow}>
                    {[4, 8, 12].map((n) => {
                      const active = repeatTimes === n;
                      return (
                        <Pressable
                          key={n}
                          onPress={() => setRepeatTimes(n)}
                          style={[styles.repeatChip, { backgroundColor: active ? theme.accent : theme.bg2 }]}
                        >
                          <Text style={[styles.repeatChipText, { color: active ? '#fff' : theme.ink2 }]}>{n}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </Card>

            <Pressable
              style={[styles.nextBtn, { backgroundColor: theme.accent }]}
              onPress={submit}
            >
              <Icons.check size={18} color="#fff" />
              <Text style={styles.nextBtnText}>
                {repeatWeeks > 0 ? `Book ${repeatTimes} Visits` : 'Confirm Booking'}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      </View>
      </SafeAreaView>
      )}
      {dialog}
    </KeyboardAvoidingView>
  );
}

function ProductToggleRow({ product, selected, onToggle }: { product: Product; selected: boolean; onToggle: () => void }) {
  const { theme } = useApp();
  const isLow = product.status === 'low' || product.status === 'out';

  return (
    <Pressable
      onPress={onToggle}
      style={[styles.productToggle, {
        backgroundColor: selected ? theme.accent + '15' : theme.card,
        borderColor: selected ? theme.accent : theme.line,
      }]}
    >
      <View style={[styles.checkbox, {
        backgroundColor: selected ? theme.accent : 'transparent',
        borderColor: selected ? theme.accent : theme.ink3,
      }]}>
        {selected && <Icons.check size={12} color="#fff" />}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.productToggleName, { color: theme.ink }]}>{product.name}</Text>
        <Text style={[styles.productToggleSub, { color: theme.ink3 }]}>{product.brand} · {product.perUse} {product.unit}</Text>
      </View>
      {isLow && <StatusBadge status={product.status} />}
    </Pressable>
  );
}

function ReviewRow({ icon, label, value, theme }: { icon: React.ReactNode; label: string; value: string; theme: any }) {
  return (
    <View style={styles.reviewRow}>
      <View style={styles.reviewIcon}>{icon}</View>
      <Text style={[styles.reviewLabel, { color: theme.ink3 }]}>{label}</Text>
      <Text style={[styles.reviewValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', fontStyle: 'italic' },
  progress: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 6 },
  progressDot: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  progressLine: { flex: 1, height: 2, borderRadius: 1, marginHorizontal: 4 },
  stepLabel: { fontSize: 11, letterSpacing: 0.5, paddingHorizontal: 20, paddingBottom: 16, fontWeight: '500' },
  stepTitle: { fontSize: 24, fontWeight: '600', fontStyle: 'italic', marginBottom: 20, letterSpacing: -0.3 },
  selectRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 0.5, borderRadius: 14, padding: 14, marginBottom: 10,
  },
  selectName: { fontSize: 15, fontWeight: '600' },
  selectSub: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 15 },
  noMatch: { fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 },
  newClientToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 12, borderWidth: 1, marginBottom: 14,
  },
  newClientToggleText: { fontSize: 14, fontWeight: '600' },
  newClientCard: { borderRadius: 14, borderWidth: 0.5, padding: 14, gap: 10, marginBottom: 14 },
  newClientInput: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  newClientCancel: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 10, borderWidth: 0.5,
  },
  newClientAdd: { flex: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10 },
  monthDivider: { justifyContent: 'flex-end', paddingBottom: 10, paddingHorizontal: 4 },
  monthDividerText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  datePill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  datePillDay: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  datePillNum: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  customToggle: { paddingVertical: 6, alignSelf: 'flex-start' },
  customToggleText: { fontSize: 13, fontWeight: '600' },
  timeSlot: { width: '22%', paddingVertical: 10, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  timeSlotText: { fontSize: 13, fontWeight: '500' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 16, borderRadius: 16,
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  productGroupLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', marginBottom: 10 },
  productToggle: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 0.5, borderRadius: 14, padding: 14, marginBottom: 8,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  productToggleName: { fontSize: 14, fontWeight: '600' },
  productToggleSub: { fontSize: 12, marginTop: 2 },
  notesInput: {
    borderWidth: 0.5, borderRadius: 12, padding: 14,
    fontSize: 14, minHeight: 80, textAlignVertical: 'top',
    marginTop: 16, marginBottom: 20,
  },
  reviewGroupLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', marginBottom: 12 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  repeatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  repeatChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  repeatChipText: { fontSize: 13, fontWeight: '600' },
  reviewIcon: { width: 24, alignItems: 'center' },
  reviewLabel: { width: 70, fontSize: 13 },
  reviewValue: { flex: 1, fontSize: 14, fontWeight: '600' },
  reviewProduct: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, justifyContent: 'space-between' },
  reviewProductName: { fontSize: 14 },
  schedWarn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 0.5, marginTop: 8,
  },
  schedWarnTitle: { fontSize: 12, fontWeight: '600' },
  schedWarnSub: { fontSize: 11, marginTop: 2, lineHeight: 16 },
  addProductBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 12, marginBottom: 4, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1,
  },
  addProductBtnText: { fontSize: 14, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12, paddingBottom: 40, paddingHorizontal: 0,
  },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)', alignSelf: 'center', marginBottom: 16 },
  pickerTitle: { fontSize: 17, fontWeight: '600', paddingHorizontal: 20, marginBottom: 12 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5 },
  pickerCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pickerRowName: { fontSize: 15, fontWeight: '500' },
  pickerRowSub: { fontSize: 12, marginTop: 2 },
  pickerDone: { margin: 20, padding: 16, borderRadius: 14, alignItems: 'center' },
  pickerDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  confirmedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  confirmedCircle: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  confirmedTitle: { fontSize: 34, fontWeight: '600', fontStyle: 'italic', marginBottom: 12 },
  confirmedSub: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  doneBtn: { paddingHorizontal: 40, paddingVertical: 16, borderRadius: 16 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
