import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { TabNavigator } from './TabNavigator';
import { useApp } from '../data/AppContext';
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

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="MainTabs" component={TabNavigator} />
      <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
      <Stack.Screen name="AppointmentDetail" component={AppointmentDetailScreen} />
      <Stack.Screen
        name="NewAppointment"
        component={NewAppointmentScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen
        name="ScanModal"
        component={ScanModal}
        options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }}
      />
      <Stack.Screen
        name="StockTake"
        component={StockTakeScreen}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="ClientForm" component={ClientFormScreen} />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} />
      <Stack.Screen name="ServiceForm" component={ServiceFormScreen} />
      <Stack.Screen
        name="RescheduleModal"
        component={RescheduleModal}
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="AppointmentEdit" component={AppointmentEditScreen} />
    </Stack.Navigator>
  );
}
