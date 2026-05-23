import React from 'react';
import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

const PALETTE = {
  light: { bg: '#FAF6F0', title: '#2A201A', body: '#6B5B4E', detail: '#A8978A' },
  dark: { bg: '#1C1714', title: '#F5EDE5', body: '#B8A89A', detail: '#7A6A5E' },
};

function ErrorScreen({ message, onReset }: { message: string; onReset: () => void }) {
  const c = PALETTE[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[styles.wrap, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.title }]}>Something went wrong</Text>
      <Text style={[styles.body, { color: c.body }]}>
        Iris hit an unexpected problem. Your saved data is safe — try again, and if it
        keeps happening, close and reopen the app.
      </Text>
      <Text style={[styles.detail, { color: c.detail }]}>{message}</Text>
      <Pressable style={styles.btn} onPress={onReset}>
        <Text style={styles.btnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorScreen message={error.message} onReset={this.reset} />;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  detail: { fontSize: 12, textAlign: 'center', marginBottom: 24 },
  btn: { backgroundColor: '#C26E4A', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
