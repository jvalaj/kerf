import type { User } from '@kerf/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** who's online right now. the server only sends people who share a project with you. */
export function OnlineList({ users, currentUserId }: { users: User[]; currentUserId?: number }) {
  const theme = useTheme();
  if (users.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Not connected
      </ThemedText>
    );
  }
  return (
    <View style={styles.row} accessibilityLabel="Online now">
      {users.map((user) => (
        <ThemedView key={user.id} type="backgroundElement" style={styles.person}>
          <View style={[styles.dot, { backgroundColor: theme.success }]} />
          <ThemedText type="small">
            {user.name}
            {user.id === currentUserId ? ' (you)' : ''}
          </ThemedText>
        </ThemedView>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
