import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { startLive, stopLive } from '@/lib/live';
import { useSession } from '@/lib/session';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const session = useSession();
  const token = session.status === 'signedIn' ? session.token : undefined;

  // keep one live connection while signed in (any screen) so you count as online
  useEffect(() => {
    if (!token) return;
    startLive(token);
    return stopLive;
  }, [token]);

  // wait until we know if a saved login is there
  if (session.status === 'loading') return null;
  const signedIn = session.status === 'signedIn';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ title: 'Projects' }} />
          <Stack.Screen name="capture" options={{ title: 'Capture' }} />
          <Stack.Screen name="dashboard" options={{ title: 'Office dashboard' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="projects/[id]" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
