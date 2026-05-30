import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { Main } from './Main';
import { useApp } from '../data/AppContext';
import { useResponsive } from '../hooks/useResponsive';
import ClientDetailScreen from '../screens/ClientDetailScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import AppointmentDetailScreen from '../screens/AppointmentDetailScreen';
import NewAppointmentScreen from '../screens/NewAppointmentScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ReportsScreen from '../screens/ReportsScreen';
import ScanModal from '../screens/ScanModal';
import StockTakeScreen from '../screens/StockTakeScreen';
import ClientFormScreen from '../screens/ClientFormScreen';
import ProductFormScreen from '../screens/ProductFormScreen';
import ServiceFormScreen from '../screens/ServiceFormScreen';
import RescheduleModal from '../screens/RescheduleModal';
import AppointmentEditScreen from '../screens/AppointmentEditScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { theme } = useApp();
  const { isLarge } = useResponsive();

  // On iPad, present the detail/edit screens as sheets (the design's slide-over
  // pattern). 'modal' renders as a scrollable page-sheet on iPad; we avoid
  // 'formSheet' because it clips the inner ScrollViews.
  const sheet = isLarge
    ? ({ presentation: 'modal' } as const)
    : undefined;
  const bottomModal = ({ presentation: 'modal', animation: 'slide_from_bottom' } as const);

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="MainTabs" component={Main} />
      <Stack.Screen name="ClientDetail" component={ClientDetailScreen} options={sheet} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={sheet} />
      <Stack.Screen name="AppointmentDetail" component={AppointmentDetailScreen} options={sheet} />
      <Stack.Screen
        name="NewAppointment"
        component={NewAppointmentScreen}
        options={bottomModal}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={sheet} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={sheet} />
      <Stack.Screen
        name="ScanModal"
        component={ScanModal}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }}
      />
      <Stack.Screen
        name="StockTake"
        component={StockTakeScreen}
        options={bottomModal}
      />
      <Stack.Screen name="ClientForm" component={ClientFormScreen} options={sheet} />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} options={sheet} />
      <Stack.Screen name="ServiceForm" component={ServiceFormScreen} options={sheet} />
      <Stack.Screen
        name="RescheduleModal"
        component={RescheduleModal}
        options={bottomModal}
      />
      <Stack.Screen name="AppointmentEdit" component={AppointmentEditScreen} options={sheet} />
    </Stack.Navigator>
  );
}
