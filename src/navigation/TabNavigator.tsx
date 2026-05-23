import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { TabParamList } from './types';
import { useApp } from '../data/AppContext';
import { Icons } from '../components/Icons';
import TodayScreen from '../screens/TodayScreen';
import ClientsScreen from '../screens/ClientsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import InventoryScreen from '../screens/InventoryScreen';

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  const { theme } = useApp();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneContainerStyle: { backgroundColor: theme.bg },
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.line,
          borderTopWidth: 0.5,
          elevation: 0,
          height: 83,
          paddingBottom: 28,
          paddingTop: 10,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.ink3,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          letterSpacing: 0.3,
          marginTop: 2,
        },
        tabBarIcon: ({ color, size }) => {
          const iconSize = 22;
          if (route.name === 'Today') return <Icons.home size={iconSize} color={color} />;
          if (route.name === 'Clients') return <Icons.users size={iconSize} color={color} />;
          if (route.name === 'Calendar') return <Icons.calendar size={iconSize} color={color} />;
          if (route.name === 'Inventory') return <Icons.inventory size={iconSize} color={color} />;
          return <View />;
        },
      })}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Clients" component={ClientsScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
    </Tab.Navigator>
  );
}
