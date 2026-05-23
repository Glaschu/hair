import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet, SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../data/AppContext';
import { RootStackParamList } from '../navigation/types';
import { Avatar, Icons, Chip, RoundBtn } from '../components';
import { groupByLetter, clientMatchesQuery } from '../data/utils';
import { Client } from '../data/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ClientsScreen() {
  const { theme, clients, appointments } = useApp();
  const nav = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'recent' | 'upcoming' | 'vip'>('all');

  const filtered = useMemo(() => {
    let list = clients;
    if (query) {
      list = list.filter((c) => clientMatchesQuery(c, query));
    }
    if (filter === 'recent') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const recentIds = new Set(
        appointments
          .filter((a) => (a.status === 'completed' || a.status === 'no-show') && new Date(a.start) >= cutoff)
          .map((a) => a.clientId)
      );
      list = list.filter((c) => recentIds.has(c.id));
    }
    if (filter === 'vip') list = list.filter((c) => c.vip);
    if (filter === 'upcoming') {
      const upcomingIds = new Set(
        appointments.filter((a) => a.status === 'upcoming').map((a) => a.clientId)
      );
      list = list.filter((c) => upcomingIds.has(c.id));
    }
    return list;
  }, [clients, appointments, query, filter]);

  const sections = useMemo(() => {
    if (query) return [{ letter: '', data: filtered }];
    return groupByLetter(filtered);
  }, [filtered, query]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: theme.ink3 }]}>DIRECTORY</Text>
          <Text style={[styles.title, { color: theme.ink }]}>Clients</Text>
        </View>
        <RoundBtn onPress={() => nav.navigate('ClientForm', {})} filled size={40}>
          <Icons.plus size={18} color={theme.bg} />
        </RoundBtn>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: theme.bg2 }]}>
        <Icons.search size={16} color={theme.ink3} />
        <TextInput
          style={[styles.searchInput, { color: theme.ink }]}
          placeholder="Search clients..."
          placeholderTextColor={theme.ink3}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {/* Filter chips */}
      <View style={styles.chipRow}>
        <Chip active={filter === 'all'} onPress={() => setFilter('all')}>All</Chip>
        <Chip active={filter === 'recent'} onPress={() => setFilter('recent')}>Recent</Chip>
        <Chip active={filter === 'upcoming'} onPress={() => setFilter('upcoming')}>Upcoming</Chip>
        <Chip active={filter === 'vip'} onPress={() => setFilter('vip')}>VIP</Chip>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) =>
          section.letter ? (
            <Text style={[styles.letterHead, { color: theme.ink3, backgroundColor: theme.bg }]}>
              {section.letter}
            </Text>
          ) : null
        }
        renderItem={({ item }) => <ClientRow client={item} />}
        ListEmptyComponent={
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <Text style={[styles.emptyText, { color: theme.ink3 }]}>
              {filter === 'vip' ? 'No VIP clients yet'
                : filter === 'upcoming' ? 'No upcoming appointments'
                : filter === 'recent' ? 'No clients seen in the last 90 days'
                : query ? 'No clients match your search'
                : 'No clients yet — tap + to add one'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const ClientRow = React.memo(function ClientRow({ client }: { client: Client }) {
  const { theme, appointments } = useApp();
  const nav = useNavigation<Nav>();

  const { nextAppt, visitCount } = useMemo(() => {
    const clientAppts = appointments.filter((a) => a.clientId === client.id);
    const next = clientAppts
      .filter((a) => a.status === 'upcoming')
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
    const visits = clientAppts.filter((a) => a.status === 'completed').length;
    return { nextAppt: next, visitCount: visits };
  }, [appointments, client.id]);

  return (
    <Pressable
      onPress={() => nav.navigate('ClientDetail', { clientId: client.id })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.bg2 : 'transparent' },
      ]}
    >
      <Avatar name={client.name} tone={client.tone} size={46} />
      <View style={styles.rowInfo}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, { color: theme.ink }]}>{client.name}</Text>
          {client.vip && (
            <View style={[styles.vipBadge, { backgroundColor: theme.accent + '20' }]}>
              <Text style={[styles.vipText, { color: theme.accent }]}>VIP</Text>
            </View>
          )}
        </View>
        <Text style={[styles.rowSub, { color: theme.ink3 }]}>
          {nextAppt
            ? `Next: ${new Date(nextAppt.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            : `${visitCount} visits · Since ${client.since}`}
        </Text>
      </View>
      <Icons.chevronRight size={16} color={theme.ink3} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  title: { fontSize: 34, fontWeight: '500', fontStyle: 'italic', letterSpacing: -0.5 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  letterHead: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 14,
  },
  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13 },
  vipBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  vipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  emptyText: { fontSize: 14, fontStyle: 'italic' },
});
