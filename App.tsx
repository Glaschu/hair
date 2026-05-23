import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_500Medium_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import {
  DMMono_400Regular,
} from '@expo-google-fonts/dm-mono';
import { View, Text, ActivityIndicator, StyleSheet, useColorScheme } from 'react-native';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import * as Sentry from '@sentry/react-native';
import { AppProvider, useApp } from './src/data/AppContext';
import { DialogProvider } from './src/data/DialogContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components';
import { db } from './src/db';
import migrations from './drizzle/migrations';

// Paste the project DSN from sentry.io here to turn on crash reporting.
// A Sentry DSN is a public client identifier — safe to commit.
const SENTRY_DSN = '';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.2,
  });
}

const STARTUP_PALETTE = {
  light: { bg: '#FAF6F0', title: '#2A201A', body: '#6B5B4E', detail: '#A8978A' },
  dark: { bg: '#1C1714', title: '#F5EDE5', body: '#B8A89A', detail: '#7A6A5E' },
};

function StartupError({ message }: { message: string }) {
  const c = STARTUP_PALETTE[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[startupStyles.wrap, { backgroundColor: c.bg }]}>
      <Text style={[startupStyles.title, { color: c.title }]}>Couldn't start Iris</Text>
      <Text style={[startupStyles.body, { color: c.body }]}>
        The app database couldn't be prepared. Close and reopen the app — if this keeps
        happening, the app may need to be reinstalled.
      </Text>
      <Text style={[startupStyles.detail, { color: c.detail }]}>{message}</Text>
    </View>
  );
}

const startupStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  detail: { fontSize: 12, textAlign: 'center' },
});

function AppShell() {
  const { theme } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavigationContainer
        theme={{
          dark: theme.dark,
          colors: {
            ...DefaultTheme.colors,
            background: theme.bg,
            card: theme.card,
            text: theme.ink,
            border: theme.line,
            notification: theme.accent,
          },
          fonts: DefaultTheme.fonts,
        }}
      >
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <DialogProvider>
          <RootNavigator />
        </DialogProvider>
      </NavigationContainer>
    </View>
  );
}

function App() {
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium,
    CormorantGaramond_400Regular_Italic,
    CormorantGaramond_500Medium_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMMono_400Regular,
  });

  const { success: migrationsOk, error: migrationError } = useMigrations(db, migrations);

  if (migrationError) {
    return <StartupError message={migrationError.message} />;
  }

  if (!fontsLoaded || !migrationsOk) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: STARTUP_PALETTE[scheme === 'dark' ? 'dark' : 'light'].bg }}>
        <ActivityIndicator color="#C26E4A" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default SENTRY_DSN ? Sentry.wrap(App) : App;
