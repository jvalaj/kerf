import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { FeedRow } from '@/components/feed-row';
import { OnlineList } from '@/components/online-list';
import { StatusMessage } from '@/components/status-message';
import { ThemedText } from '@/components/themed-text';
import { layout } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportMeasurements } from '@/lib/export';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';

export default function DashboardScreen() {
  const theme = useTheme();
  const { unit } = useSettings();
  const session = useSession();
  const live = useLive();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  async function exportCsv() {
    setExporting(true);
    setExportError(undefined);
    try {
      await exportMeasurements(unit);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  // list comes from the live connection, so it stays up to date
  const connected = live.status === 'live';

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={layout.content}
      data={live.items}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <FeedRow item={item} unit={unit} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.section}>
            <ThemedText type="smallBold">Online now</ThemedText>
            <OnlineList
              users={live.online}
              currentUserId={session.status === 'signedIn' ? session.user.id : undefined}
            />
          </View>

          <View style={styles.titleRow}>
            <View style={styles.title}>
              <ThemedText type="smallBold">Recent measurements</ThemedText>
              <View style={styles.status}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: connected ? theme.success : theme.warning },
                  ]}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {connected ? 'Live' : 'Reconnecting…'}
                </ThemedText>
              </View>
            </View>
            <Button
              title={exporting ? 'Exporting…' : 'Export CSV'}
              disabled={exporting}
              onPress={exportCsv}
            />
          </View>
          {exportError && (
            <ThemedText type="small" themeColor="danger">
              {exportError}
            </ThemedText>
          )}
        </View>
      }
      ListEmptyComponent={<StatusMessage loading={!live.loaded} />}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  title: {
    flex: 1,
    gap: Spacing.half,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
