import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import { HourlyBars } from '@/features/today/HourlyBars';
import { SleepSummaryView } from '@/features/today/SleepSummaryView';
import {
  heartRateStats,
  hourlySteps,
  lastSleepSession,
  sumTotals,
} from '@/features/today/stats';
import { useTodayData } from '@/features/today/useTodayData';
import { formatClock, formatCount, formatDateTime, formatDistance } from '@/format';
import { useWatch } from '@/state/WatchProvider';

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <AppText variant="figure" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

export default function TodayScreen() {
  const { linkState, device, lastSync, totals, error, dataVersion, sync } = useWatch();
  const { data, error: loadError } = useTodayData(dataVersion);

  const view = useMemo(() => {
    if (!data) return null;
    const watchTotals = totals && totals.at >= data.dayStart ? totals : null;
    return {
      totals: watchTotals ?? sumTotals(data.samples),
      totalsFromWatch: watchTotals !== null,
      heart: heartRateStats(data.samples),
      hourly: hourlySteps(data.samples),
      sleep: lastSleepSession(data.sleep),
      hasSamples: data.samples.length > 0,
    };
  }, [data, totals]);

  const canSync = linkState === 'connected' && device !== null;

  return (
    <Screen>
      <Section title="Sync">
        <Button
          label={linkState === 'syncing' ? 'Syncing' : 'Sync now'}
          variant="primary"
          disabled={!canSync}
          loading={linkState === 'syncing'}
          onPress={() => void sync()}
        />
        <AppText variant="caption" muted>
          {lastSync !== null ? `Last sync ${formatDateTime(lastSync)}` : 'Not synced yet'}
        </AppText>
        {!canSync && linkState !== 'syncing' ? (
          <AppText variant="caption" muted>
            Connect your watch on the Device tab to sync.
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" danger>
            {error}
          </AppText>
        ) : null}
        {loadError ? (
          <AppText variant="caption" danger>
            Could not read stored data: {loadError}
          </AppText>
        ) : null}
      </Section>

      <Section title="Today">
        <View style={styles.figures}>
          <Figure label="steps" value={formatCount(view?.totals.steps ?? 0)} />
          <Figure label="calories" value={formatCount(view?.totals.calories ?? 0)} />
          <Figure label="distance" value={formatDistance(view?.totals.distance ?? 0)} />
        </View>
        <AppText variant="caption" muted>
          {view?.totalsFromWatch
            ? 'Totals as reported by the watch at the last sync.'
            : view?.hasSamples
              ? 'Totals added up from stored one-minute samples.'
              : 'Nothing stored for today yet. Sync to pull today from the watch.'}
        </AppText>
      </Section>

      <Section title="Heart rate today">
        {view?.heart ? (
          <>
            <KeyValue
              label={`Latest (${formatClock(view.heart.latest.timestamp)})`}
              value={`${view.heart.latest.bpm} bpm`}
            />
            <KeyValue label="Lowest" value={`${view.heart.min} bpm`} />
            <KeyValue label="Highest" value={`${view.heart.max} bpm`} />
          </>
        ) : (
          <AppText variant="caption" muted>
            No heart-rate readings stored for today.
          </AppText>
        )}
      </Section>

      <Section title="Steps per hour today">
        <HourlyBars steps={view?.hourly ?? new Array<number>(24).fill(0)} />
      </Section>

      <Section title="Last night's sleep">
        <SleepSummaryView summary={view?.sleep ?? null} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  figures: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  figure: { flex: 1, gap: 2 },
});
