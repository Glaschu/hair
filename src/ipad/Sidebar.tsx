import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useApp } from '../data/AppContext';
import { Icons } from '../components';
import { initials } from '../data/utils';
import { Section, useShell } from './shellContext';
import { SERIF } from '../theme';

interface NavDef {
  id: Section;
  label: string;
  icon: (typeof Icons)[keyof typeof Icons];
  badge?: number;
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { theme, products, studioName } = useApp();
  const { section, setSection } = useShell();

  const lowCount = products.filter((p) => p.status === 'low' || p.status === 'out').length;

  const workspace: NavDef[] = [
    { id: 'today', label: 'Today', icon: Icons.home },
    { id: 'clients', label: 'Clients', icon: Icons.users },
    { id: 'calendar', label: 'Calendar', icon: Icons.calendar },
    { id: 'inventory', label: 'Inventory', icon: Icons.inventory, badge: lowCount || undefined },
  ];
  const footer: NavDef[] = [
    { id: 'reports', label: 'Reports', icon: Icons.trend },
    { id: 'settings', label: 'Settings', icon: Icons.settings },
  ];

  const go = (id: Section) => {
    Haptics.selectionAsync();
    setSection(id);
  };

  const renderItem = (n: NavDef) => {
    const active = section === n.id;
    const Icon = n.icon;
    return (
      <Pressable
        key={n.id}
        onPress={() => go(n.id)}
        accessibilityRole="button"
        accessibilityLabel={n.label}
        style={[
          styles.item,
          collapsed && styles.itemCollapsed,
          active && { backgroundColor: theme.card, shadowColor: theme.shadow, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
        ]}
      >
        <Icon size={21} color={active ? theme.accent : theme.ink2} />
        {!collapsed && (
          <Text style={[styles.itemLabel, { color: active ? theme.ink : theme.ink2 }]}>{n.label}</Text>
        )}
        {!collapsed && n.badge ? (
          <View style={[styles.badge, { backgroundColor: theme.accent + '22' }]}>
            <Text style={[styles.badgeText, { color: theme.accent }]}>{n.badge}</Text>
          </View>
        ) : null}
        {collapsed && n.badge ? (
          <View style={[styles.badgeDot, { backgroundColor: theme.accent, borderColor: theme.bg2 }]} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={[styles.sidebar, { backgroundColor: theme.bg2, borderRightColor: theme.line, width: collapsed ? 72 : 224 }]}>
      {/* Logo */}
      <View style={[styles.logoRow, collapsed && { justifyContent: 'center', paddingHorizontal: 0 }]}>
        <View style={[styles.logoDot, { backgroundColor: theme.accent }]} />
        {!collapsed && <Text style={[styles.logo, { color: theme.ink }]}>{studioName}</Text>}
      </View>

      <View style={{ gap: 2 }}>
        {!collapsed && <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>WORKSPACE</Text>}
        {workspace.map(renderItem)}
      </View>

      <View style={{ flex: 1 }} />

      <View style={[styles.footer, { borderTopColor: theme.line }]}>
        {footer.map(renderItem)}
        {!collapsed && (
          <View style={styles.userRow}>
            <View style={[styles.userAvatar, { backgroundColor: theme.accent }]}>
              <Text style={styles.userAvatarText}>{initials(studioName)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.userName, { color: theme.ink }]} numberOfLines={1}>{studioName}</Text>
              <Text style={[styles.userRole, { color: theme.ink3 }]} numberOfLines={1}>Owner · {studioName} Studio</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    height: '100%',
    borderRightWidth: 0.5,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
    flexShrink: 0,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 22 },
  logoDot: { width: 10, height: 10, borderRadius: 5 },
  logo: { fontSize: 26, fontFamily: SERIF, letterSpacing: -0.5 },
  sectionLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12,
  },
  itemCollapsed: { justifyContent: 'center', paddingHorizontal: 0, gap: 0, position: 'relative' },
  itemLabel: { fontSize: 15, fontWeight: '500', flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeDot: { position: 'absolute', top: 8, right: 16, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  footer: { borderTopWidth: 0.5, paddingTop: 10, gap: 2 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 14 },
  userAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { color: '#fff', fontSize: 12, fontFamily: SERIF },
  userName: { fontSize: 13, fontWeight: '600' },
  userRole: { fontSize: 11, marginTop: 1 },
});
