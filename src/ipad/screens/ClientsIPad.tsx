import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Linking, Image, Modal, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../../data/AppContext';
import { useDialog } from '../../data/DialogContext';
import { useResponsive } from '../../hooks/useResponsive';
import { savePhoto, getPhotoUri } from '../../db/photos';
import { RootStackParamList } from '../../navigation/types';
import { Avatar, Icons, Chip, RoundBtn } from '../../components';
import { fmt, groupByLetter, clientMatchesQuery } from '../../data/utils';
import { Client, ClientPhoto, Appointment } from '../../data/types';
import { Eyebrow, Title, Btn } from '../ui';
import { useShell } from '../shellContext';
import { SERIF } from '../../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Filter = 'all' | 'recent' | 'upcoming' | 'vip';

export function ClientsIPad() {
  const { theme, clients, appointments } = useApp();
  const { isLandscape } = useResponsive();
  const { selectedClientId, setSelectedClientId } = useShell();
  const nav = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    let list = clients;
    if (query) list = list.filter((c) => clientMatchesQuery(c, query));
    if (filter === 'recent') {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
      const ids = new Set(appointments.filter((a) => (a.status === 'completed' || a.status === 'no-show' || a.status === 'cancelled') && new Date(a.start) >= cutoff).map((a) => a.clientId));
      list = list.filter((c) => ids.has(c.id));
    }
    if (filter === 'vip') list = list.filter((c) => c.vip);
    if (filter === 'upcoming') {
      const ids = new Set(appointments.filter((a) => a.status === 'upcoming').map((a) => a.clientId));
      list = list.filter((c) => ids.has(c.id));
    }
    return list;
  }, [clients, appointments, query, filter]);

  const sections = useMemo(() => query ? [{ letter: '', data: filtered }] : groupByLetter(filtered), [filtered, query]);

  // Keep a client focused in the detail pane while in landscape.
  useEffect(() => {
    if (!isLandscape) return;
    const exists = selectedClientId && clients.some((c) => c.id === selectedClientId);
    if (!exists) setSelectedClientId(filtered[0]?.id ?? clients[0]?.id ?? null);
  }, [isLandscape, selectedClientId, clients, filtered, setSelectedClientId]);

  const onSelect = (c: Client) => {
    if (isLandscape) setSelectedClientId(c.id);
    else nav.navigate('ClientDetail', { clientId: c.id });
  };

  const list = (
    <View style={[styles.listPane, isLandscape && { width: 360, borderRightWidth: 0.5, borderRightColor: theme.line }]}>
      <View style={{ paddingHorizontal: 22, paddingTop: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>DIRECTORY</Eyebrow>
            <Title size={30} style={{ marginTop: 2 }}>Clients</Title>
          </View>
          <RoundBtn filled size={40} onPress={() => nav.navigate('ClientForm', {})}><Icons.plus size={18} color={theme.bg} /></RoundBtn>
        </View>
        <View style={[styles.search, { backgroundColor: theme.bg2 }]}>
          <Icons.search size={16} color={theme.ink3} />
          <TextInput
            style={[styles.searchInput, { color: theme.ink }]}
            placeholder="Search clients…"
            placeholderTextColor={theme.ink3}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
        </View>
        <View style={styles.chipRow}>
          <Chip active={filter === 'all'} onPress={() => setFilter('all')}>All {clients.length}</Chip>
          <Chip active={filter === 'recent'} onPress={() => setFilter('recent')}>Recent</Chip>
          <Chip active={filter === 'upcoming'} onPress={() => setFilter('upcoming')}>Upcoming</Chip>
          <Chip active={filter === 'vip'} onPress={() => setFilter('vip')}>VIP</Chip>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {sections.map((g) => (
          <View key={g.letter || 'all'}>
            {g.letter ? <Text style={[styles.letter, { color: theme.ink3, backgroundColor: theme.bg }]}>{g.letter}</Text> : <View style={{ height: 8 }} />}
            {g.data.map((c) => (
              <ClientListRow key={c.id} client={c} selected={isLandscape && c.id === selectedClientId} onPress={() => onSelect(c)} />
            ))}
          </View>
        ))}
        {filtered.length === 0 && (
          <Text style={{ color: theme.ink3, fontStyle: 'italic', textAlign: 'center', paddingVertical: 40 }}>
            {query ? 'No clients match your search' : 'No clients yet'}
          </Text>
        )}
      </ScrollView>
    </View>
  );

  if (!isLandscape) return <View style={{ flex: 1 }}>{list}</View>;

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {list}
      <View style={{ flex: 1, minWidth: 0 }}>
        {selectedClientId
          ? <ClientDetailPanel clientId={selectedClientId} />
          : <View style={styles.emptyDetail}><Text style={{ color: theme.ink3, fontStyle: 'italic' }}>Select a client</Text></View>}
      </View>
    </View>
  );
}

const ClientListRow = React.memo(function ClientListRow({ client, selected, onPress }: { client: Client; selected: boolean; onPress: () => void }) {
  const { theme, appointments } = useApp();
  const { nextAppt, visits } = useMemo(() => {
    const a = appointments.filter((x) => x.clientId === client.id);
    const n = a.filter((x) => x.status === 'upcoming').sort((p, q) => new Date(p.start).getTime() - new Date(q.start).getTime())[0];
    return { nextAppt: n, visits: a.filter((x) => x.status === 'completed').length };
  }, [appointments, client.id]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listRow, { backgroundColor: selected ? theme.card : pressed ? theme.bg2 : 'transparent', borderColor: selected ? theme.line : 'transparent' }]}>
      <Avatar name={client.name} tone={client.tone} photo={client.photo} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontWeight: '600', fontSize: 14, color: theme.ink }} numberOfLines={1}>{client.name}</Text>
          {client.vip && <View style={[styles.vip, { borderColor: theme.accent }]}><Text style={{ color: theme.accent, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 }}>VIP</Text></View>}
        </View>
        <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {nextAppt ? `Next: ${new Date(nextAppt.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : `${visits} visit${visits === 1 ? '' : 's'} · Since ${client.since}`}
        </Text>
      </View>
      {selected && <Icons.chevronRight size={16} color={theme.accent} />}
    </Pressable>
  );
});

// ──────────────── Detail panel ────────────────
type DetailView = 'visits' | 'photos';

function ClientDetailPanel({ clientId }: { clientId: string }) {
  const { theme, clients, setClients, appointments, products } = useApp();
  const dialog = useDialog();
  const nav = useNavigation<Nav>();
  const [view, setView] = useState<DetailView>('visits');
  const [viewing, setViewing] = useState<ClientPhoto | null>(null);
  const [saving, setSaving] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  // Snap back to the visit timeline whenever the focused client changes.
  useEffect(() => { setView('visits'); }, [clientId]);
  if (!client) return null;

  const clientAppts = appointments.filter((a) => a.clientId === client.id);
  const upcoming = clientAppts.filter((a) => a.status === 'upcoming').sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const completed = clientAppts.filter((a) => a.status === 'completed').sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const history = clientAppts.filter((a) => a.status === 'completed' || a.status === 'no-show' || a.status === 'cancelled').sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const totalVisits = completed.length;
  const totalSpend = completed.reduce((s, a) => s + a.price, 0);
  const avg = totalVisits > 0 ? Math.round(totalSpend / totalVisits) : 0;

  const addPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      await dialog.alert({ title: 'Permission Denied', message: 'Photo library access is required.' });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, quality: 0.8, mediaTypes: ['images'] });
    if (res.canceled) return;
    setSaving(true);
    try {
      const saved = await Promise.all(res.assets.map((a) => savePhoto(a.uri)));
      const newPhotos: ClientPhoto[] = saved.map((uri) => ({ id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date: new Date().toISOString(), url: uri, label: '' }));
      setClients((cs) => cs.map((c) => c.id === client.id ? { ...c, photos: [...newPhotos, ...(c.photos || [])], updatedAt: Date.now() } : c));
    } catch {
      await dialog.alert({ title: "Couldn't save photos", message: 'The photos could not be saved. Please try again.' });
    } finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
      {/* Docked profile — formula and allergies stay visible beside the timeline */}
      <ProfileDock
        client={client}
        totalVisits={totalVisits}
        totalSpend={totalSpend}
        avg={avg}
        lastFinishedAppt={completed[0]}
        onEdit={() => nav.navigate('ClientForm', { clientId: client.id })}
        onBook={() => nav.navigate('NewAppointment', { clientId: client.id, prefillService: completed[0]?.service })}
      />

      {/* Timeline pane */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={[styles.timelineHead, { borderBottomColor: theme.line }]}>
          <View style={{ flex: 1 }}>
            <Eyebrow>THE STORY SO FAR</Eyebrow>
            <Title size={26} style={{ marginTop: 2 }}>{view === 'visits' ? 'Visits' : 'Photos'}</Title>
          </View>
          <Chip active={view === 'visits'} onPress={() => setView('visits')}>Visits {upcoming.length + history.length}</Chip>
          <Chip active={view === 'photos'} onPress={() => setView('photos')}>Photos {(client.photos ?? []).length}</Chip>
        </View>
        <ScrollView contentContainerStyle={{ padding: 28, paddingTop: 20 }} showsVerticalScrollIndicator={false}>
          {view === 'visits'
            ? <VisitTimeline client={client} upcoming={upcoming} history={history} products={products} onOpenAppt={(id) => nav.navigate('AppointmentDetail', { appointmentId: id })} onViewPhoto={setViewing} />
            : <PhotosTab client={client} onAdd={addPhotos} onView={setViewing} saving={saving} />}
        </ScrollView>
      </View>

      {viewing && (
        <Modal visible animationType="fade" onRequestClose={() => setViewing(null)}>
          <Pressable style={styles.photoViewer} onPress={() => setViewing(null)}>
            <Image source={{ uri: getPhotoUri(viewing.url) }} style={styles.photoViewerImg} resizeMode="contain" />
            <Text style={styles.photoViewerDate}>{fmt.rel(viewing.date)}</Text>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { theme } = useApp();
  return (
    <View>
      <Text style={{ fontSize: 24, fontFamily: SERIF, letterSpacing: -0.5, color: theme.ink }}>{value}</Text>
      <Text style={{ fontSize: 10, letterSpacing: 1.2, fontWeight: '500', color: theme.ink3, marginTop: 4 }}>{label.toUpperCase()}</Text>
    </View>
  );
}
function Divider() { const { theme } = useApp(); return <View style={{ width: 0.5, backgroundColor: theme.line }} />; }

function ProfileDock({ client, totalVisits, totalSpend, avg, lastFinishedAppt, onEdit, onBook }: {
  client: Client; totalVisits: number; totalSpend: number; avg: number;
  lastFinishedAppt?: Appointment; onEdit: () => void; onBook: () => void;
}) {
  const { theme } = useApp();
  return (
    <ScrollView
      style={[styles.dock, { borderRightColor: theme.line, backgroundColor: theme.accent + '0A' }]}
      contentContainerStyle={{ padding: 18, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ alignItems: 'center' }}>
        <Avatar name={client.name} tone={client.tone} photo={client.photo} size={76} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <Title size={22} style={{ textAlign: 'center', flexShrink: 1 }}>{client.name}</Title>
          <RoundBtn size={28} onPress={onEdit}><Icons.edit size={13} color={theme.ink} /></RoundBtn>
        </View>
        {client.vip && (
          <View style={[styles.vip, { borderColor: theme.accent, marginTop: 6, paddingHorizontal: 8 }]}>
            <Text style={{ color: theme.accent, fontSize: 9, fontWeight: '700', letterSpacing: 1 }}>VIP CLIENT</Text>
          </View>
        )}
        <Eyebrow style={{ marginTop: 8 }}>SINCE {client.since} · {totalVisits} VISIT{totalVisits === 1 ? '' : 'S'}</Eyebrow>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        <RoundBtn size={38} onPress={() => Linking.openURL(`tel:${client.phone}`)}><Icons.phone size={16} color={theme.ink} /></RoundBtn>
        <RoundBtn size={38} onPress={() => Linking.openURL(`sms:${client.phone}`)}><Icons.message size={16} color={theme.ink} /></RoundBtn>
        {client.instagram && (
          <RoundBtn size={38} onPress={() => {
            const handle = client.instagram?.replace('@', '');
            Linking.openURL(`https://ig.me/m/${handle}`).catch(() => Linking.openURL(`https://instagram.com/${handle}`));
          }}><Icons.instagram size={16} color={theme.ink} /></RoundBtn>
        )}
      </View>
      <Btn variant="primary" icon={<Icons.plus size={15} color="#fff" />} onPress={onBook}>Book appointment</Btn>

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icons.flask size={14} color={theme.accent} />
          <Eyebrow color={theme.accent}>
            {lastFinishedAppt ? `FORMULA · ${new Date(lastFinishedAppt.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase()}` : 'FORMULA'}
          </Eyebrow>
        </View>
        <View style={{ backgroundColor: theme.accent + '14', borderRadius: 10, padding: 12, marginTop: 8 }}>
          <Text style={{ fontFamily: 'DMMono_400Regular', fontSize: 12, lineHeight: 18, color: theme.ink }}>
            {(lastFinishedAppt?.formula) || client.formula || 'Not recorded'}
          </Text>
        </View>
      </Panel>

      <Panel>
        <Eyebrow color={theme.warn}>ALLERGIES & SENSITIVITIES</Eyebrow>
        <Text style={{ color: theme.ink, fontSize: 13, marginTop: 6, lineHeight: 18 }}>{client.allergies}</Text>
      </Panel>

      <Panel>
        <Eyebrow>HAIR</Eyebrow>
        <ProfileRow label="Type" value={client.hair.type} />
        <ProfileRow label="Length" value={client.hair.length} />
        <ProfileRow label="Natural" value={client.hair.natural} />
      </Panel>

      {client.notes ? (
        <Panel>
          <Eyebrow>PREFERENCES / NOTES</Eyebrow>
          <Text style={{ color: theme.ink, fontSize: 13, marginTop: 6, lineHeight: 18 }}>{client.notes}</Text>
        </Panel>
      ) : null}

      <Panel>
        <Eyebrow>CONTACT</Eyebrow>
        <Pressable onPress={() => Linking.openURL(`tel:${client.phone}`)} style={styles.contactRow}>
          <Icons.phone size={16} color={theme.accent} />
          <Text style={{ flex: 1, color: theme.ink, fontSize: 13 }} numberOfLines={1}>{client.phone || '—'}</Text>
          <Icons.arrowRight size={14} color={theme.ink3} />
        </Pressable>
        <View style={{ height: 0.5, backgroundColor: theme.line }} />
        <Pressable onPress={() => Linking.openURL(`mailto:${client.email}`)} style={styles.contactRow}>
          <Icons.message size={16} color={theme.accent} />
          <Text style={{ flex: 1, color: theme.ink, fontSize: 13 }} numberOfLines={1}>{client.email || '—'}</Text>
          <Icons.arrowRight size={14} color={theme.ink3} />
        </Pressable>
      </Panel>

      <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'center', paddingBottom: 8 }}>
        <Stat label="Total spend" value={totalSpend > 0 ? fmt.currency(totalSpend) : '—'} />
        <Divider />
        <Stat label="Avg / visit" value={totalVisits > 0 ? fmt.currency(avg) : '—'} />
      </View>
    </ScrollView>
  );
}

function TimelineDate({ iso, tone }: { iso: string; tone?: string }) {
  const { theme } = useApp();
  const d = new Date(iso);
  return (
    <View style={{ width: 56, alignItems: 'flex-start', paddingTop: 4 }}>
      <Text style={{ fontSize: 10, letterSpacing: 0.8, fontWeight: '500', color: tone ?? theme.ink3 }}>{d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text>
      <Text style={{ fontSize: 28, fontFamily: SERIF, color: tone ?? theme.ink, lineHeight: 30 }}>{d.getDate()}</Text>
      <Text style={{ fontSize: 11, color: theme.ink3 }}>{d.getFullYear()}</Text>
    </View>
  );
}

function VisitTimeline({ client, upcoming, history, products, onOpenAppt, onViewPhoto }: { client: Client; upcoming: Appointment[]; history: Appointment[]; products: any[]; onOpenAppt: (id: string) => void; onViewPhoto: (p: ClientPhoto) => void }) {
  const { theme } = useApp();
  if (upcoming.length === 0 && history.length === 0) {
    return <Text style={{ color: theme.ink3, fontStyle: 'italic', paddingVertical: 20 }}>No visits yet — book the first one from the left.</Text>;
  }
  return (
    <View style={{ gap: 16 }}>
      {/* What's booked, soonest first */}
      {upcoming.map((a) => (
        <Pressable key={a.id} onPress={() => onOpenAppt(a.id)} style={{ flexDirection: 'row', gap: 16 }}>
          <TimelineDate iso={a.start} tone={theme.accent} />
          <View style={[styles.panel, { backgroundColor: theme.accent + '14', borderColor: theme.accent + '33', flex: 1 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Eyebrow color={theme.accent}>UPCOMING · {fmt.rel(a.start).toUpperCase()}</Eyebrow>
                <Text style={{ fontWeight: '600', fontSize: 16, color: theme.ink, marginTop: 6 }}>{a.service}</Text>
                <Text style={{ color: theme.ink2, fontSize: 13, marginTop: 2 }}>{fmt.time(a.start)} · {fmt.currency(a.price)}</Text>
              </View>
              <Btn variant="dark" compact onPress={() => onOpenAppt(a.id)}>Open</Btn>
            </View>
          </View>
        </Pressable>
      ))}

      {/* Past visits, newest first */}
      {history.map((a) => {
        const noShow = a.status === 'no-show';
        const cancelled = a.status === 'cancelled';
        return (
          <Pressable key={a.id} onPress={() => onOpenAppt(a.id)} style={{ flexDirection: 'row', gap: 16 }}>
            <TimelineDate iso={a.start} tone={noShow ? theme.danger : undefined} />
            <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line, flex: 1 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', fontSize: 16, color: theme.ink }}>{a.service}</Text>
                  <Text style={{ color: theme.ink2, fontSize: 13, marginTop: 2 }}>{fmt.ago(a.start)}</Text>
                </View>
                {noShow
                  ? <View style={[styles.vip, { borderColor: theme.danger }]}><Text style={{ color: theme.danger, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 }}>NO SHOW</Text></View>
                  : cancelled
                  ? <View style={[styles.vip, { borderColor: theme.ink3 }]}><Text style={{ color: theme.ink3, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 }}>CANCELLED</Text></View>
                  : <Text style={{ fontSize: 20, fontFamily: SERIF, color: theme.ink }}>{fmt.currency(a.price)}</Text>}
              </View>
              {!noShow && a.formula && (
                <>
                  <View style={{ height: 0.5, backgroundColor: theme.line, marginVertical: 12 }} />
                  <Eyebrow style={{ marginBottom: 6 }}>FORMULA</Eyebrow>
                  <Text style={{ color: theme.ink, fontSize: 13 }}>{a.formula}</Text>
                </>
              )}
              {!noShow && a.notes && (
                <>
                  <View style={{ height: 0.5, backgroundColor: theme.line, marginVertical: 12 }} />
                  <Eyebrow style={{ marginBottom: 6 }}>NOTES</Eyebrow>
                  <Text style={{ color: theme.ink, fontSize: 13 }}>{a.notes}</Text>
                </>
              )}
              {!noShow && a.products.length > 0 && (
                <>
                  <View style={{ height: 0.5, backgroundColor: theme.line, marginVertical: 12 }} />
                  <Eyebrow style={{ marginBottom: 6 }}>PRODUCTS USED</Eyebrow>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {a.products.map((ap) => {
                      const p = products.find((x) => x.id === ap.productId);
                      if (!p) return null;
                      return <View key={ap.productId} style={{ backgroundColor: theme.accent + '14', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ fontSize: 12, color: theme.ink2 }}>{p.brand} {p.name}</Text></View>;
                    })}
                  </View>
                </>
              )}
              {client.photos?.some((p) => p.appointmentId === a.id) && (
                <>
                  <View style={{ height: 0.5, backgroundColor: theme.line, marginVertical: 12 }} />
                  <Eyebrow style={{ marginBottom: 6 }}>PHOTOS</Eyebrow>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {client.photos.filter((p) => p.appointmentId === a.id).map((p) => (
                      <Pressable key={p.id} onPress={() => onViewPhoto(p)} style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden' }}>
                        <Image source={{ uri: getPhotoUri(p.url) }} style={{ flex: 1 }} resizeMode="cover" />
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function PhotosTab({ client, onAdd, onView, saving }: { client: Client; onAdd: () => void; onView: (p: ClientPhoto) => void; saving: boolean }) {
  const { theme } = useApp();
  const photos = client.photos || [];
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <Eyebrow style={{ flex: 1 }}>PHOTOS · {photos.length}</Eyebrow>
        <Btn compact icon={<Icons.camera size={14} color={theme.ink} />} onPress={onAdd} disabled={saving}>Add</Btn>
      </View>
      {photos.length === 0 ? (
        <Pressable onPress={onAdd} style={[styles.addPhoto, { backgroundColor: theme.bg2, borderColor: theme.ink3 + '66' }]}>
          {saving ? <ActivityIndicator color={theme.ink3} /> : <Icons.camera size={24} color={theme.ink3} />}
          <Text style={{ color: theme.ink2, fontSize: 12, fontWeight: '500', marginTop: 8 }}>Tap to add photos</Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {photos.map((p) => (
            <Pressable key={p.id} onPress={() => onView(p)} style={[styles.photoTile, { overflow: 'hidden' }]}>
              <Image source={{ uri: getPhotoUri(p.url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={styles.photoDateOverlay}><Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 9, fontWeight: '500' }}>{fmt.rel(p.date)}</Text></View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  const { theme } = useApp();
  return <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>{children}</View>;
}
function ProfileRow({ label, value }: { label: string; value: string }) {
  const { theme } = useApp();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={{ color: theme.ink3, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listPane: { height: '100%' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999 },
  searchInput: { flex: 1, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 4 },
  letter: { fontSize: 11, letterSpacing: 1.4, fontWeight: '700', paddingHorizontal: 8, paddingTop: 14, paddingBottom: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 0.5 },
  vip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  emptyDetail: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // ScrollView's base style has flexGrow/flexShrink 1, which turns `width` into a
  // flex basis and lets the dock balloon in the row — pin it to exactly 264.
  dock: { width: 264, flexGrow: 0, flexShrink: 0, borderRightWidth: 0.5 },
  timelineHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 28, paddingTop: 20, paddingBottom: 14, borderBottomWidth: 0.5 },
  panel: { borderRadius: 16, borderWidth: 0.5, padding: 18 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  addPhoto: { borderRadius: 14, borderWidth: 1, padding: 48, alignItems: 'center' },
  photoTile: { width: 132, height: 132, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0002' },
  photoDateOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, paddingTop: 18 },
  photoViewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  photoViewerImg: { width: '100%', flex: 1, borderRadius: 12 },
  photoViewerDate: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 12 },
});
