import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../data/AppContext';
import { useResponsive } from '../hooks/useResponsive';
import { IPadShellProvider, useShell } from './shellContext';
import { Sidebar } from './Sidebar';
import { TodayIPad } from './screens/TodayIPad';
import { ClientsIPad } from './screens/ClientsIPad';
import { CalendarIPad } from './screens/CalendarIPad';
import { InventoryIPad } from './screens/InventoryIPad';
import { ReportsIPad } from './screens/ReportsIPad';
import { SettingsIPad } from './screens/SettingsIPad';
import { RoomMode } from './screens/RoomMode';

function ShellInner() {
  const { theme } = useApp();
  const { isLandscape } = useResponsive();
  const { section, clientMode } = useShell();

  // Client mode replaces the whole UI with the room-safe layout — no sidebar,
  // no section content, just RoomMode. The lock in RoomMode is the only exit.
  if (clientMode) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
        <RoomMode />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Sidebar collapsed={!isLandscape} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {section === 'today' && <TodayIPad />}
          {section === 'clients' && <ClientsIPad />}
          {section === 'calendar' && <CalendarIPad />}
          {section === 'inventory' && <InventoryIPad />}
          {section === 'reports' && <ReportsIPad />}
          {section === 'settings' && <SettingsIPad />}
        </View>
      </View>
    </SafeAreaView>
  );
}

export function IPadShell() {
  return (
    <IPadShellProvider>
      <ShellInner />
    </IPadShellProvider>
  );
}
