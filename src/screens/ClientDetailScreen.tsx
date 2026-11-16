import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Linking, Image,
  FlatList, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../data/AppContext';
import { useLocalDialog } from '../components/Dialog';
import { savePhoto, deletePhoto, getPhotoUri } from '../db/photos';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Card, Icons, RoundBtn, EmptyState, PhotoStrip } from '../components';
import { useResponsive } from '../hooks/useResponsive';
import { fmt } from '../data/utils';
import { treatmentSummary, TreatmentSummaryRow } from '../data/visits';
import { openInstagram } from '../data/links';
import { ClientPhoto, Appointment } from '../data/types';
import { SERIF } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ClientDetail'>;
type Tab = 'overview' | 'history' | 'photos';

export default function ClientDetailScreen() {
  const { theme, clients, setClients, appointments, products, bookingEnabled, backend } = useApp();
  const { isLarge } = useResponsive();
  const { confirm, alert, actionSheet, dialog } = useLocalDialog();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const [tab, setTab] = useState<Tab>('overview');
  const [viewingPhoto, setViewingPhoto] = useState<ClientPhoto | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const client = clients.find((c) => c.id === route.params.clientId);
  if (!client) return null;

  const clientAppts = appointments.filter((a) => a.clientId === client.id);
  const upcomingAppts = clientAppts
    .filter((a) => a.status === 'upcoming')
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const completedAppts = clientAppts
    .filter((a) => a.status === 'completed')
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  const historyAppts = clientAppts
    .filter((a) => a.status === 'completed' || a.status === 'no-show' || a.status === 'cancelled')
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  const lastVisit = completedAppts[0]?.start;
  const totalVisits = completedAppts.length;
  const totalSpend = completedAppts.reduce((sum, a) => sum + a.price, 0);
  const avgPerVisit = totalVisits > 0 ? Math.round(totalSpend / totalVisits) : 0;

  const pickProfilePhoto = async () => {
    const perform = async (useCamera: boolean) => {
      try {
        if (useCamera) {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (perm.status !== 'granted') {
            await alert({ title: 'Permission Denied', message: 'Camera access is required to take photos.' });
            return;
          }
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (perm.status !== 'granted') {
            await alert({ title: 'Permission Denied', message: 'Photo library access is required to choose photos.' });
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
            if (client.photo) await deletePhoto(client.photo);
            setClients((cs) => cs.map((c) => c.id === client.id ? { ...c, photo: uri, updatedAt: Date.now() } : c));
          } catch {
            await alert({
              title: "Couldn't save photo",
              message: 'The photo could not be saved. Please try again.',
            });
          } finally {
            setSavingPhoto(false);
          }
        }
      } catch (e) {
        await alert({ title: 'Error', message: 'Could not open camera or library.' });
      }
    };
    const idx = await actionSheet({
      title: 'Photo',
      actions: [{ label: 'Take Photo' }, { label: 'Choose from Library' }],
    });
    if (idx === 0) perform(true);
    else if (idx === 1) perform(false);
  };

  const addPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      await alert({ title: 'Permission Denied', message: 'Photo library access is required to choose photos.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true, quality: 0.8,
      mediaTypes: ['images'],
    });
    if (!result.canceled) {
      try {
        const saved = await Promise.all(result.assets.map(a => savePhoto(a.uri)));
        const newPhotos: ClientPhoto[] = saved.map((uri) => ({
          id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: new Date().toISOString(),
          url: uri,
          label: '',
        }));
        setClients((cs) => cs.map((c) => c.id === client.id
          ? { ...c, photos: [...newPhotos, ...(c.photos || [])], updatedAt: Date.now() }
          : c));
      } catch {
        await alert({
          title: "Couldn't save photos",
          message: 'The photos could not be saved. Please try again.',
        });
      }
    }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Hair' },
    { id: 'history', label: 'History' },
    { id: 'photos', label: 'Photos' },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Nav bar */}
      <View style={styles.navRow}>
        <RoundBtn label="Back" onPress={() => nav.goBack()} size={38}>
          <Icons.chevronLeft size={18} color={theme.ink} />
        </RoundBtn>
        <RoundBtn onPress={() => nav.navigate('ClientForm', { clientId: client.id })} size={38}>
          <Icons.edit size={16} color={theme.ink} />
        </RoundBtn>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
       <View style={isLarge ? styles.contentWide : undefined}>
        {/* Hero — centred */}
        <View style={styles.hero}>
          <Pressable onPress={pickProfilePhoto} style={styles.avatarWrap} disabled={savingPhoto}>
            <Avatar name={client.name} tone={client.tone} photo={client.photo} size={92} />
            <View style={[styles.camBadge, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <Icons.camera size={14} color={theme.ink2} />
            </View>
            {savingPhoto && (
              <View style={styles.avatarLoading}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </Pressable>
          <Text style={[styles.heroName, { color: theme.ink }]}>{client.name}</Text>
          {client.vip && (
            <View style={[styles.vipBadge, { backgroundColor: theme.accent + '20' }]}>
              <Text style={[styles.vipText, { color: theme.accent }]}>VIP CLIENT</Text>
            </View>
          )}
          <Text style={[styles.heroSince, { color: theme.ink3 }]}>
            CLIENT SINCE {client.since} · {totalVisits} VISITS
          </Text>

          {/* Action buttons */}
          <View style={styles.actionRow}>
            {[
              { icon: <Icons.phone size={18} color={theme.ink} />, label: 'Call', onPress: () => Linking.openURL(`tel:${client.phone}`) },
              { icon: <Icons.message size={18} color={theme.ink} />, label: 'Message', onPress: () => Linking.openURL(`sms:${client.phone}`) },
              ...(client.instagram ? [{ icon: <Icons.instagram size={18} color={theme.ink} />, label: 'Insta', onPress: () => { openInstagram(client.instagram); } }] : []),
              { icon: <Icons.plus size={18} color={theme.ink} />, label: 'Book', onPress: () => nav.navigate('NewAppointment', { clientId: client.id, prefillService: completedAppts[0]?.service }) },
              // Shown whenever she has the feature switched on. If there is no
              // service behind it yet, the tap explains and offers to set one up
              // — she used to get all the way through picking times before
              // finding out.
              ...(bookingEnabled ? [{
                icon: <Icons.calendar size={18} color={theme.ink} />,
                label: 'Send link',
                onPress: async () => {
                  if (backend.has('booking-links')) {
                    nav.navigate('SendBookingLink', { clientId: client.id });
                    return;
                  }
                  const { why, action } = backend.why('booking-links');
                  const go = await confirm({
                    title: 'Not set up yet',
                    message: why,
                    confirmLabel: action?.label ?? 'OK',
                  });
                  if (go && action) nav.navigate(action.route as 'BookingSetup');
                },
              }] : []),
            ].map((a) => (
              <Pressable key={a.label} onPress={a.onPress}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: pressed ? theme.bg2 : theme.card, borderColor: theme.line }]}>
                {a.icon}
                <Text style={[styles.actionLabel, { color: theme.ink2 }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Stats strip */}
        <View style={[styles.statsStrip, { borderTopColor: theme.line, borderBottomColor: theme.line }]}>
          {[
            { label: 'TOTAL SPEND', value: totalSpend > 0 ? fmt.currency(totalSpend) : '—' },
            { label: 'LAST VISIT', value: lastVisit ? fmt.ago(lastVisit) : '—' },
            { label: 'AVG / VISIT', value: totalVisits > 0 ? fmt.currency(avgPerVisit) : '—' },
          ].map((s, i) => (
            <View key={s.label} style={[styles.statCell, i > 0 && { borderLeftWidth: 0.5, borderLeftColor: theme.line }]}>
              <Text style={[styles.statValue, { color: theme.ink }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: theme.ink3 }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Tabs */}
        <View style={[styles.tabBar, { borderBottomColor: theme.line }]}>
          {TABS.map((t) => (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.tabBtn}>
              <Text style={[styles.tabLabel, { color: tab === t.id ? theme.ink : theme.ink3 }]}>{t.label}</Text>
              {tab === t.id && <View style={[styles.tabUnderline, { backgroundColor: theme.accent }]} />}
            </Pressable>
          ))}
        </View>

        {/* Tab content */}
        {tab === 'overview' && (
          <OverviewTab
            client={client}
            upcomingAppts={upcomingAppts}
            lastFinishedAppt={completedAppts[0]}
            treatments={treatmentSummary(client.id, completedAppts)}
            nav={nav}
            isLarge={isLarge}
            onAddPhotos={addPhotos}
          />
        )}
        {tab === 'history' && (
          <HistoryTab historyAppts={historyAppts} products={products} nav={nav} client={client} onViewPhoto={setViewingPhoto} photoSize={isLarge ? 88 : 48} />
        )}
        {tab === 'photos' && (
          <PhotosTab client={client} onAdd={addPhotos} onView={setViewingPhoto} perRow={isLarge ? 3 : 2} />
        )}
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
    </SafeAreaView>
  );
}

function OverviewTab({ client, upcomingAppts, lastFinishedAppt, treatments, nav, isLarge, onAddPhotos }: {
  client: any; upcomingAppts: Appointment[]; lastFinishedAppt?: Appointment;
  treatments: TreatmentSummaryRow[]; nav: any; isLarge: boolean; onAddPhotos: () => void;
}) {
  const { theme } = useApp();

  // Photos belong next to the formula — the pair she shows clients in the
  // chair. iPad has room for a column beside it; the phone stacks a
  // swipeable strip directly under the formula instead.
  const photos: ClientPhoto[] = client.photos || [];
  const photoCard = (size: number, horizontal: boolean) => (
    <Card>
      <View style={styles.cardHead}>
        <Icons.camera size={16} color={theme.accent} />
        <Text style={[styles.sectionLabel, { color: theme.ink3, marginBottom: 0, flex: 1 }]}>PHOTOS</Text>
        {photos.length > 0 && (
          <Text style={[styles.sectionLabel, { color: theme.ink3, marginBottom: 0 }]}>{photos.length}</Text>
        )}
      </View>
      {photos.length === 0 ? (
        // Most clients start with none — say what belongs here rather than
        // leaving a lone tile floating in an empty panel.
        <Pressable
          onPress={onAddPhotos}
          accessibilityRole="button"
          style={({ pressed }) => [styles.photoEmpty, {
            borderColor: theme.accent + '55',
            backgroundColor: pressed ? theme.accent + '14' : theme.accent + '08',
          }]}
        >
          <Icons.camera size={26} color={theme.accent} />
          <Text style={[styles.photoEmptyTitle, { color: theme.ink }]}>Add before & after photos</Text>
          <Text style={[styles.photoEmptySub, { color: theme.ink3 }]}>
            They show up here with the formula — handy for showing {String(client.name).split(' ')[0]} what you did last time.
          </Text>
        </Pressable>
      ) : (
        <PhotoStrip photos={photos} size={size} horizontal={horizontal} onAdd={onAddPhotos} />
      )}
    </Card>
  );

  const detailsTop = (
    <>
      {/* Upcoming */}
      {upcomingAppts.length > 0 && (
        <View>
          <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>UPCOMING</Text>
          {upcomingAppts.map((appt) => (
            <Pressable key={appt.id}
              onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}
              style={[styles.upcomingCard, { backgroundColor: theme.accent + '15', borderColor: theme.accent + '40' }]}>
              <View style={[styles.upcomingDate, { borderRightColor: theme.accent + '60' }]}>
                <Text style={[styles.upcomingMonth, { color: theme.accent }]}>
                  {new Date(appt.start).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                </Text>
                <Text style={[styles.upcomingDay, { color: theme.accent }]}>
                  {new Date(appt.start).getDate()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.upcomingService, { color: theme.ink }]}>{appt.service}</Text>
                <Text style={[styles.upcomingTime, { color: theme.ink2 }]}>
                  {fmt.time(appt.start)} · {fmt.currency(appt.price)}
                </Text>
              </View>
              <Icons.chevronRight size={14} color={theme.accent} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Hair + formula */}
      <Card>
        <View style={styles.cardHead}>
          <Icons.flask size={16} color={theme.accent} />
          <Text style={[styles.sectionLabel, { color: theme.ink3, marginBottom: 0 }]}>HAIR PROFILE</Text>
        </View>
        <HairRow label="Type" value={client.hair.type} theme={theme} />
        <HairRow label="Length" value={client.hair.length} theme={theme} />
        <HairRow label="Natural" value={client.hair.natural} theme={theme} />
        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>
          {lastFinishedAppt ? `FORMULA (LAST APPT: ${new Date(lastFinishedAppt.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()})` : 'FORMULA'}
        </Text>
        <View style={[styles.formulaBox, { backgroundColor: theme.bg2 }]}>
          <Text style={[styles.formulaText, { color: theme.ink }]}>
            {(lastFinishedAppt?.formula) || client.formula || 'Not recorded'}
          </Text>
        </View>
      </Card>

    </>
  );

  const detailsRest = (
    <>
      {/* Treatments — what they have done, how often, when last */}
      {treatments.length > 0 && (
        <Card>
          <View style={styles.cardHead}>
            <Icons.scissors size={16} color={theme.accent} />
            <Text style={[styles.sectionLabel, { color: theme.ink3, marginBottom: 0 }]}>TREATMENTS</Text>
          </View>
          {treatments.map((t, i) => (
            <View key={t.service}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line }]} />}
              <View style={styles.treatmentRow}>
                <Text style={[styles.treatmentName, { color: theme.ink }]} numberOfLines={1}>{t.service}</Text>
                <Text style={[styles.treatmentMeta, { color: theme.ink3 }]}>
                  ×{t.count} · {fmt.ago(t.last)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* Allergies + notes */}
      <Card>
        <Text style={[styles.sectionLabel, { color: theme.warn }]}>ALLERGIES & SENSITIVITIES</Text>
        <Text style={[styles.bodyText, { color: theme.ink }]}>{client.allergies}</Text>
        <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 14 }]} />
        <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>PREFERENCES / CLIENT NOTES</Text>
        <Text style={[styles.bodyText, { color: theme.ink }]}>{client.notes || '—'}</Text>
        {lastFinishedAppt?.notes && (
          <>
            <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 14 }]} />
            <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>LATEST APPOINTMENT NOTES</Text>
            <Text style={[styles.bodyText, { color: theme.ink }]}>{lastFinishedAppt.notes}</Text>
          </>
        )}
      </Card>

      {/* Contact */}
      <Card style={{ gap: 0, padding: 0 }}>
        <ContactRow icon={<Icons.phone size={16} color={theme.accent} />} label={client.phone}
          onPress={() => Linking.openURL(`tel:${client.phone}`)} theme={theme} />
        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <ContactRow icon={<Icons.message size={16} color={theme.accent} />} label={client.email}
          onPress={() => Linking.openURL(`mailto:${client.email}`)} theme={theme} />
      </Card>
    </>
  );

  if (isLarge) {
    return (
      <View style={{ flexDirection: 'row', gap: 16, padding: 20, alignItems: 'flex-start' }}>
        <View style={{ flex: 1.15, minWidth: 0, gap: 14 }}>{detailsTop}{detailsRest}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{photoCard(156, false)}</View>
      </View>
    );
  }

  return (
    <View style={{ padding: 20, gap: 14 }}>
      {detailsTop}
      {photoCard(112, true)}
      {detailsRest}
    </View>
  );
}

function HistoryTab({ historyAppts, products, nav, client, onViewPhoto, photoSize }: {
  historyAppts: Appointment[]; products: any[]; nav: any; client: any;
  onViewPhoto: (p: ClientPhoto) => void; photoSize: number;
}) {
  const { theme } = useApp();

  if (historyAppts.length === 0) {
    return (
      <EmptyState
        icon={<Icons.calendar size={28} color={theme.ink3} />}
        title="No history yet"
        subtitle="Completed and past appointments will show up here."
      />
    );
  }

  return (
    <View style={{ padding: 20, gap: 12 }}>
      {historyAppts.map((appt) => {
        const isNoShow = appt.status === 'no-show';
        return (
          <Pressable key={appt.id} onPress={() => nav.navigate('AppointmentDetail', { appointmentId: appt.id })}>
            <View style={styles.timelineRow}>
              <View style={styles.timelineDateCol}>
                <Text style={[styles.timelineMon, { color: isNoShow ? theme.danger : theme.ink3 }]}>
                  {new Date(appt.start).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                </Text>
                <Text style={[styles.timelineDay, { color: isNoShow ? theme.danger : theme.ink }]}>
                  {new Date(appt.start).getDate()}
                </Text>
                <Text style={[styles.timelineYear, { color: theme.ink3 }]}>{new Date(appt.start).getFullYear()}</Text>
              </View>
              <Card style={{ flex: 1 }}>
                <View style={styles.histCardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.histService, { color: theme.ink }]}>{appt.service}</Text>
                    <Text style={[styles.histAgo, { color: theme.ink2 }]}>{fmt.ago(appt.start)}</Text>
                  </View>
                  {isNoShow ? (
                    <View style={[styles.noShowBadge, { backgroundColor: theme.danger + '18', borderColor: theme.danger + '40' }]}>
                      <Text style={[styles.noShowBadgeText, { color: theme.danger }]}>NO SHOW</Text>
                    </View>
                  ) : (
                    <Text style={[styles.histPrice, { color: theme.ink }]}>{fmt.currency(appt.price)}</Text>
                  )}
                </View>
                {!isNoShow && appt.formula && (
                  <>
                    <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 8 }]} />
                    <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>FORMULA</Text>
                    <Text style={[styles.bodyText, { color: theme.ink }]}>{appt.formula}</Text>
                  </>
                )}
                {!isNoShow && (appt.technique || appt.timing) && (
                  <>
                    <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 8 }]} />
                    <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>TECHNIQUE</Text>
                    <Text style={[styles.bodyText, { color: theme.ink }]}>
                      {[appt.technique, appt.timing].filter(Boolean).join(' · ')}
                    </Text>
                  </>
                )}
                {!isNoShow && appt.nextNotes && (
                  <>
                    <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 8 }]} />
                    <Text style={[styles.sectionLabel, { color: theme.accent }]}>NEXT TIME</Text>
                    <Text style={[styles.bodyText, { color: theme.ink }]}>{appt.nextNotes}</Text>
                  </>
                )}
                {!isNoShow && appt.notes && (
                  <>
                    <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 8 }]} />
                    <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>NOTES</Text>
                    <Text style={[styles.bodyText, { color: theme.ink }]}>{appt.notes}</Text>
                  </>
                )}
                {!isNoShow && appt.products.length > 0 && (
                  <>
                    <View style={[styles.divider, { backgroundColor: theme.line, marginVertical: 8 }]} />
                    <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>PRODUCTS USED</Text>
                    <View style={styles.chipWrap}>
                      {appt.products.map((ap) => {
                        const p = products.find((x: any) => x.id === ap.productId);
                        if (!p) return null;
                        return (
                          <View key={ap.productId} style={[styles.chip, { backgroundColor: theme.bg2 }]}>
                            <Text style={[styles.chipText, { color: theme.ink2 }]}>{p.brand} {p.name}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
                {client?.photos?.some((p: any) => p.appointmentId === appt.id) && (
                  <View style={{ marginTop: 12, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {client.photos.filter((p: any) => p.appointmentId === appt.id).map((p: any) => (
                      <Pressable key={p.id} onPress={() => onViewPhoto(p)} style={{ width: photoSize, height: photoSize, borderRadius: 8, overflow: 'hidden' }}>
                        <Image source={{ uri: getPhotoUri(p.url) }} style={{ flex: 1 }} resizeMode="cover" />
                      </Pressable>
                    ))}
                  </View>
                )}
              </Card>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function PhotosTab({ client, onAdd, onView, perRow }: {
  client: any; onAdd: () => void; onView: (p: ClientPhoto) => void; perRow: number;
}) {
  const { theme } = useApp();
  const photos: ClientPhoto[] = client.photos || [];

  const allItems = [{ type: 'add' as const }, ...photos.map((p) => ({ type: 'photo' as const, data: p }))];
  const pairs: typeof allItems[] = [];
  for (let i = 0; i < allItems.length; i += perRow) pairs.push(allItems.slice(i, i + perRow));

  return (
    <View style={{ padding: 20, gap: 10 }}>
      {photos.length === 0 && (
        <Pressable onPress={onAdd} style={[styles.addPhotoFullTile, { backgroundColor: theme.bg2, borderColor: theme.ink3 }]}>
          <Icons.camera size={24} color={theme.ink3} />
          <Text style={[styles.addPhotoLabel, { color: theme.ink2 }]}>Tap to add photos</Text>
        </Pressable>
      )}
      {pairs.map((pair, pi) => (
        <View key={pi} style={styles.photoRow}>
          {pair.map((item, ii) => {
            if (item.type === 'add') {
              return (
                <Pressable key="add" onPress={onAdd}
                  style={[styles.photoTile, { backgroundColor: theme.bg2, borderColor: theme.ink3 + '60', borderWidth: 1 }]}>
                  <Icons.camera size={22} color={theme.ink3} />
                  <Text style={[styles.addPhotoLabel, { color: theme.ink2 }]}>Add photo</Text>
                </Pressable>
              );
            }
            if (item.type === 'photo') {
              const p = item.data as ClientPhoto;
              return (
                <Pressable key={p.id} onPress={() => onView(p)} style={[styles.photoTile, { overflow: 'hidden' }]}>
                  <Image source={{ uri: getPhotoUri(p.url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <View style={styles.photoDateOverlay}>
                    <Text style={styles.photoDateText}>{fmt.rel(p.date)}</Text>
                  </View>
                </Pressable>
              );
            }
            return null;
          })}
          {/* Keep the last row's tiles the same size as the rest. */}
          {Array.from({ length: perRow - pair.length }).map((_, i) => <View key={`gap-${i}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

function HairRow({ label, value, theme }: { label: string; value: string; theme: any }) {
  return (
    <View style={styles.hairRow}>
      <Text style={[styles.hairLabel, { color: theme.ink3 }]}>{label}</Text>
      <Text style={[styles.hairValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

function ContactRow({ icon, label, onPress, theme }: { icon: React.ReactNode; label: string; onPress: () => void; theme: any }) {
  return (
    <Pressable style={styles.contactRow} onPress={onPress}>
      {icon}
      <Text style={[styles.contactLabel, { color: theme.ink }]}>{label}</Text>
      <Icons.arrowRight size={14} color={theme.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },

  hero: { alignItems: 'center', padding: 20, paddingTop: 8, gap: 6 },
  avatarWrap: { position: 'relative', marginBottom: 8 },
  avatarLoading: {
    position: 'absolute', width: 92, height: 92, borderRadius: 46,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  camBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 30, height: 30, borderRadius: 15, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  heroName: { fontSize: 30, fontFamily: SERIF, letterSpacing: -0.4, lineHeight: 34, textAlign: 'center' },
  vipBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  vipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  heroSince: { fontSize: 10, letterSpacing: 1.4, fontWeight: '500', textAlign: 'center' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 14, borderWidth: 0.5,
    alignItems: 'center', gap: 4,
  },
  actionLabel: { fontSize: 11, fontWeight: '500' },

  statsStrip: { flexDirection: 'row', borderTopWidth: 0.5, borderBottomWidth: 0.5, marginVertical: 4 },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statValue: { fontSize: 20, fontFamily: SERIF, letterSpacing: -0.3 },
  statLabel: { fontSize: 9, letterSpacing: 1, fontWeight: '500', marginTop: 2 },

  tabBar: { flexDirection: 'row', borderBottomWidth: 0.5, paddingHorizontal: 6 },
  tabBtn: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, position: 'relative' },
  tabLabel: { fontSize: 13, fontWeight: '500' },
  tabUnderline: { position: 'absolute', bottom: -1, left: 6, right: 6, height: 2, borderRadius: 1 },

  sectionLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', marginBottom: 8 },
  bodyText: { fontSize: 13, lineHeight: 20 },
  divider: { height: 0.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  // Full-screen on iPad, but text stays a readable measure rather than
  // stretching the whole width of the display.
  contentWide: { width: '100%', maxWidth: 1120, alignSelf: 'center' },
  photoEmpty: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14,
    paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 8,
  },
  photoEmptyTitle: { fontSize: 14, fontWeight: '600' },
  photoEmptySub: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  treatmentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  treatmentName: { fontSize: 14, fontWeight: '600', flex: 1 },
  treatmentMeta: { fontSize: 12.5 },
  hairRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  hairLabel: { fontSize: 13 },
  hairValue: { fontSize: 13, fontWeight: '500' },
  formulaBox: { borderRadius: 10, padding: 12 },
  formulaText: { fontFamily: 'DMMono_400Regular', fontSize: 12, lineHeight: 18 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  contactLabel: { flex: 1, fontSize: 14 },

  upcomingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, borderRadius: 14, borderWidth: 0.5, marginBottom: 8,
  },
  upcomingDate: { width: 46, alignItems: 'center', borderRightWidth: 0.5, paddingRight: 14 },
  upcomingMonth: { fontSize: 9, letterSpacing: 0.8, fontWeight: '600' },
  upcomingDay: { fontSize: 24, fontFamily: SERIF, lineHeight: 26 },
  upcomingService: { fontSize: 14, fontWeight: '600' },
  upcomingTime: { fontSize: 12, marginTop: 2 },

  timelineRow: { flexDirection: 'row', gap: 14 },
  timelineDateCol: { width: 44, flexShrink: 0, paddingTop: 4, alignItems: 'flex-start' },
  timelineMon: { fontSize: 9, letterSpacing: 0.8, fontWeight: '500' },
  timelineDay: { fontSize: 24, fontFamily: SERIF, lineHeight: 26, marginTop: 2 },
  timelineYear: { fontSize: 10, marginTop: 2 },
  histCardHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  histService: { fontSize: 14, fontWeight: '600' },
  histAgo: { fontSize: 11, marginTop: 2 },
  histPrice: { fontSize: 18, fontFamily: SERIF },
  noShowBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 0.5,
  },
  noShowBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  chipText: { fontSize: 11 },

  photoRow: { flexDirection: 'row', gap: 10 },
  photoTile: { flex: 1, aspectRatio: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  addPhotoFullTile: { borderRadius: 14, borderWidth: 1, padding: 40, alignItems: 'center', gap: 8 },
  addPhotoLabel: { fontSize: 11, fontWeight: '500' },
  photoDateOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 8, paddingTop: 20,
  },
  photoDateText: { fontSize: 9, letterSpacing: 0.6, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  placeholderService: { fontSize: 11, marginTop: 5, paddingLeft: 2 },
  photoViewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  photoViewerImg: { width: '100%', flex: 1, borderRadius: 12 },
  photoViewerDate: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 12 },
  emptyState: { padding: 60, alignItems: 'center' },
  emptyText: { fontStyle: 'italic', fontSize: 16 },
});
