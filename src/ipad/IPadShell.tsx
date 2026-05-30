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

function ShellInner() {
  const { theme } = useApp();
  const { isLandscape } = useResponsive();
  const { section } = useShell();

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
