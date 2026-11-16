import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { layout } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

export default function SignInScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const ready = username.trim().length > 0 && password.length > 0 && !busy;

  async function signIn() {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      // on success the session changes and the root layout swaps this screen for the app.
      await api.signIn(username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[layout.content, styles.content]}
      keyboardShouldPersistTaps="handled">
      <ThemedText type="subtitle">Kerf</ThemedText>
      <ThemedText themeColor="textSecondary">Sign in to see your projects.</ThemedText>
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={signIn}
      />
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button
        title={busy ? 'Signing in…' : 'Sign in'}
        variant="primary"
        disabled={!ready}
        onPress={signIn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    maxWidth: 420,
    gap: Spacing.three,
    paddingTop: Spacing.five,
  },
});
