import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Metric } from '@/components/Metric';
import { NavRow } from '@/components/NavRow';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { StatTile } from '@/components/StatTile';
import { elapsedSec, formatGrams, isActive } from '@/features/live/liveWorkout';
import { HourlyBars } from '@/features/today/HourlyBars';
import { scoreFor } from '@/features/sleep/nights';
import { SleepSummaryView } from '@/features/today/SleepSummaryView';
import { isLinkUp } from '@/features/device/linkState';
import {
  heartRateStats,
  hourlySteps,
  lastSleepSession,
  pickHeartReading,
  sumTotals,
} from '@/features/today/stats';
import { useLiveHeartRate } from '@/features/today/useLiveHeartRate';
import { useStepGoal } from '@/features/today/useStepGoal';
import { useTodayData } from '@/features/today/useTodayData';
import { WatchHero } from '@/features/today/WatchHero';
import { computeScores } from '@/features/today/scores';
import { MorningCheckin } from '@/features/today/MorningCheckin';
import { ScoresCard } from '@/features/today/ScoresCard';
import { formatElapsed } from '@/features/workouts/summary';
import { formatClock, formatCount, formatDistance } from '@/format';
import { useNow } from '@/hooks/useNow';
import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

/** Splits `1.23 km` into its number and unit. */
function splitDistance(meters: number): { value: string; unit: string } {
  const [value, unit] = formatDistance(meters).split(' ');
  return { value, unit };
}

const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/** How often the hero re-checks whether the live reading is stale and re-words "5 min ago". */
const HERO_TICK_MS = 5_000;

export default function TodayScreen() {
  const router = useRouter();
  const colors = useColors();
  const { linkState, device, battery, lastSync, totals, error, dataVersion, sync } = useWatch();
  const { data, error: loadError } = useTodayData(dataVersion);
  const goal = useStepGoal();
  const live = useLiveHeartRate(isLinkUp(linkState));
  const liveWorkout = useLiveWorkout();

  const view = useMemo(() => {
    if (!data) return null;
    const watchTotals = totals && totals.at >= data.dayStart ? totals : null;
    const sleep = lastSleepSession(data.sleep);
    return {
      totals: watchTotals ?? sumTotals(data.samples),
      totalsFromWatch: watchTotals !== null,
      heart: heartRateStats(data.samples),
      hourly: hourlySteps(data.samples),
      sleep,
      sleepScore: sleep ? scoreFor(sleep.start, sleep.end, data.sleepScores) : null,
      hasSamples: data.samples.length > 0,
      scores: computeScores(data),
    };
  }, [data, totals]);

  const canSync = linkState === 'connected' && device !== null;
  const syncing = linkState === 'syncing';
  const loading = view === null && loadError === null;
  const distance = splitDistance(view?.totals.distance ?? 0);
  const nowMs = useNow(HERO_TICK_MS);
  const heartReading = pickHeartReading(live, data?.latestHeart ?? null, nowMs);

  return (
    <Screen
      title="Today"
      caption={new Date().toLocaleDateString(undefined, WEEKDAY_FORMAT)}
      refresh={{ refreshing: syncing, onRefresh: () => void sync(), enabled: canSync }}>
      <View style={styles.stack}>
        <WatchHero
          linkState={linkState}
          deviceName={device ? (device.productModel ?? device.name) : null}
          steps={view?.totals.steps ?? 0}
          goal={goal}
          heart={heartReading}
          nowSec={Math.floor(nowMs / 1000)}
          onEnableHeartRate={() => router.push('/settings/sync')}
          battery={battery}
          lastSync={lastSync}
          action={
            canSync || syncing ? (
              <Button
                label={syncing ? 'Syncing' : 'Sync now'}
                variant="inverse"
                icon="sync"
                disabled={!canSync}
                loading={syncing}
                onPress={() => void sync()}
              />
            ) : linkState === 'disconnected' ? (
              <Button label="Connect watch" variant="inverse" icon="bluetooth" onPress={() => router.push('/watch')} />
            ) : null
          }
        />
        {isActive(liveWorkout) ? (
          <Card>
            <NavRow
              icon="pulse"
              tint="workouts"
              title={`${liveWorkout.sportName ?? 'Workout'} ${liveWorkout.status === 'paused' ? 'paused' : 'in progress'}`}
              subtitle={`${formatElapsed(elapsedSec(liveWorkout, nowMs))}${liveWorkout.heartRate !== null ? ` · ${liveWorkout.heartRate} bpm` : ''} · fat ${formatGrams(liveWorkout.fatGrams)} g, carbs ${formatGrams(liveWorkout.carbGrams)} g`}
              onPress={() => router.push('/workout-live')}
            />
          </Card>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {loadError ? <Notice tone="danger">Could not read stored data: {loadError}</Notice> : null}
      </View>

      {view ? <ScoresCard readiness={view.scores.readiness} today={view.scores.today} onPress={() => router.push('/readiness')} /> : null}

      {data ? (
        <MorningCheckin hrv={data.hrv} dayStart={data.dayStart} nowMs={nowMs} connected={isLinkUp(linkState)} onMeasure={() => router.push('/hrv')} />
      ) : null}

      {loading ? (
        <View style={styles.tiles}>
          <Skeleton width="48%" height={112} radius={18} />
          <Skeleton width="48%" height={112} radius={18} />
        </View>
      ) : (
        <View style={styles.stack}>
          <View style={styles.tiles}>
            <StatTile icon="flame" tint="workouts" label="Calories" value={formatCount(view?.totals.calories ?? 0)} unit="kcal" />
            <StatTile icon="trail-sign" tint="steps" label="Distance" value={distance.value} unit={distance.unit} />
          </View>
          <AppText variant="caption" muted style={styles.note}>
            {view?.totalsFromWatch
              ? 'Totals as reported by the watch at the last sync.'
              : view?.hasSamples
                ? 'Totals added up from stored one-minute samples.'
                : 'Nothing stored for today yet. Sync to pull today from the watch.'}
          </AppText>
        </View>
      )}

      <Section title="Heart rate today" icon="heart" tint="heart">
        {view?.heart ? (
          <View style={styles.heartRow}>
            <View style={styles.heartMain}>
              <Metric value={String(view.heart.latest.bpm)} unit="bpm" size="lg" color={colors.heartText} unitColor={colors.mutedForeground} />
              <AppText variant="caption" muted>
                Latest, {formatClock(view.heart.latest.timestamp)}
              </AppText>
            </View>
            <View style={styles.heartRange}>
              <View>
                <Metric value={String(view.heart.min)} unit="bpm" size="sm" />
                <AppText variant="caption" muted>
                  Lowest
                </AppText>
              </View>
              <View>
                <Metric value={String(view.heart.max)} unit="bpm" size="sm" />
                <AppText variant="caption" muted>
                  Highest
                </AppText>
              </View>
            </View>
          </View>
        ) : loading ? (
          <Skeleton width="60%" height={38} />
        ) : (
          <AppText variant="caption" muted>
            No heart-rate readings stored for today.
          </AppText>
        )}
      </Section>

      <Section title="Steps per hour today" icon="footsteps" tint="steps">
        <HourlyBars steps={view?.hourly ?? new Array<number>(24).fill(0)} />
      </Section>

      <Section title="Last night's sleep" icon="moon" tint="sleep" onPress={() => router.push('/sleep')}>
        {loading ? <Skeleton width="50%" height={38} /> : <SleepSummaryView summary={view?.sleep ?? null} score={view?.sleepScore ?? null} />}
      </Section>

      <Card>
        <NavRow
          icon="pulse"
          tint="heart"
          title="Health metrics"
          subtitle="Skin temperature, HRV, stress and more"
          onPress={() => router.push('/health')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  tiles: { flexDirection: 'row', gap: spacing.md },
  note: { paddingHorizontal: spacing.xs },
  heartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  heartMain: { gap: 2 },
  heartRange: { flexDirection: 'row', gap: spacing.lg },
});
