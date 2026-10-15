import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { MetricCard } from '@/features/health/MetricCard';
import { metaOrFallback } from '@/features/health/metrics';
import { useHealthMetrics } from '@/features/health/useHealthMetrics';
import { useNow } from '@/hooks/useNow';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/** Keeps "3 h ago" right without re-querying. */
const AGO_TICK_MS = 60_000;

/** Health metrics the watch stores in its data dictionary: latest value, a 7-day line, and what the watch does not support. */
export function HealthScreen() {
  const router = useRouter();
  const { linkState, device, dataVersion, sync } = useWatch();
  const { data, error } = useHealthMetrics(dataVersion);
  const nowSec = Math.floor(useNow(AGO_TICK_MS) / 1000);

  const canSync = linkState === 'connected' && device !== null;
  const syncing = linkState === 'syncing';

  const cards = data?.metrics.filter((m) => m.latest !== null || m.status?.supported === 1) ?? [];
  const unsupported = data?.metrics.filter((m) => m.latest === null && m.status !== null && m.status.supported !== 1) ?? [];
  const empty = data !== null && data.metrics.length === 0;

  return (
    <Screen refresh={{ refreshing: syncing, onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title="Health" />
      {error ? <Notice tone="danger">Could not read stored data: {error}</Notice> : null}

      {data === null && error === null ? (
        <View style={styles.stack}>
          <Skeleton width="100%" height={140} radius={24} />
          <Skeleton width="100%" height={140} radius={24} />
        </View>
      ) : null}

      {empty ? (
        <EmptyState
          icon="pulse"
          title="No health metrics yet"
          description="Connect the watch and sync. The metrics it supports appear here after the first sync."
          action={
            canSync
              ? { label: 'Sync now', icon: 'sync', onPress: () => void sync() }
              : linkState === 'disconnected'
                ? { label: 'Connect watch', icon: 'bluetooth', onPress: () => router.push('/watch') }
                : undefined
          }
        />
      ) : null}

      {data !== null && !empty ? (
        <Notice>Unverified on the watch: these layouts come from Gadgetbridge and Huawei Health, not from a Fit 4.</Notice>
      ) : null}

      {cards.map((metric) => (
        <MetricCard key={metric.type} metric={metric} nowSec={nowSec} />
      ))}

      {unsupported.length > 0 ? (
        <Section title="Not supported by this watch" icon="close-circle" tint="neutral">
          {unsupported.map((metric, i) => (
            <View key={metric.type} style={styles.stack}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.item}>
                <AppText variant="bodyStrong">{metaOrFallback(metric.type).label || metric.status?.title || metric.type}</AppText>
                <AppText variant="caption" muted>
                  {metric.status?.gate}
                </AppText>
                {metric.status?.note ? (
                  <AppText variant="caption" muted>
                    {metric.status.note}
                  </AppText>
                ) : null}
              </View>
            </View>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  item: { gap: 2 },
});
