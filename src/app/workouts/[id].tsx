import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { Card, Screen, Section } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { Notice, Skeleton } from '@/components/States';
import {
  getWorkout,
  listWorkoutPoints,
  type WorkoutPointRow,
  type WorkoutRow,
} from '@/db/queries';
import { HeartRateChart } from '@/features/workouts/HeartRateChart';
import { RouteView } from '@/features/workouts/RouteView';
import { sportIcon } from '@/features/workouts/sportIcon';
import {
  formatElapsed,
  formatPace,
  formatSpeed,
  formatWorkoutDistance,
  kmSplits,
  parseSummary,
  routePoints,
  type WorkoutSummary,
} from '@/features/workouts/summary';
import { errorMessage, formatClock, formatCount, formatDateTime } from '@/format';
import { radius, spacing } from '@/theme';

interface Loaded {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  points: WorkoutPointRow[];
}

/** `x.y m`, or null when the summary does not have the value. */
function metres(value: number | undefined): string | null {
  return value === undefined ? null : `${value.toFixed(1)} m`;
}

/** The pace or speed rows that fit the sport: swimming per 100 m, running and walking per km, the rest km/h. */
function paceRows(summary: WorkoutSummary): { label: string; value: string }[] {
  if (summary.avgPaceSecPer100m !== undefined) {
    const rows = [{ label: 'Average pace', value: formatPace(summary.avgPaceSecPer100m, '100 m') }];
    if (summary.minPaceSecPer100m !== undefined) {
      rows.push({ label: 'Best pace', value: formatPace(summary.minPaceSecPer100m, '100 m') });
    }
    return rows;
  }
  if (summary.avgPaceSecPerKm !== undefined) {
    const rows = [{ label: 'Average pace', value: formatPace(summary.avgPaceSecPerKm, 'km') }];
    if (summary.minPaceSecPerKm !== undefined) {
      rows.push({ label: 'Best pace', value: formatPace(summary.minPaceSecPerKm, 'km') });
    }
    return rows;
  }
  const rows: { label: string; value: string }[] = [];
  if (summary.avgSpeed !== undefined) rows.push({ label: 'Average speed', value: formatSpeed(summary.avgSpeed) });
  if (summary.maxSpeed !== undefined) rows.push({ label: 'Top speed', value: formatSpeed(summary.maxSpeed) });
  return rows;
}

export default function WorkoutDetailScreen() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const workoutId = Number(id);
      (async () => {
        const found = await getWorkout(db, workoutId);
        if (!found) throw new Error('This workout is no longer stored');
        const points = await listWorkoutPoints(db, workoutId);
        return { workout: found.workout, summary: parseSummary(found.summaryJson), points };
      })().then(
        (value) => {
          if (!cancelled) setLoaded(value);
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
    }, [db, id]),
  );

  const route = useMemo(() => (loaded ? routePoints(loaded.points) : []), [loaded]);
  const splits = useMemo(() => (loaded ? kmSplits(loaded.summary) : []), [loaded]);

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Workout' }} />
        {error !== null ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <>
            <Skeleton width="100%" height={216} radius={radius.card} />
            <Skeleton width="100%" height={280} radius={radius.card} />
            <Skeleton width="100%" height={200} radius={radius.card} />
          </>
        )}
      </Screen>
    );
  }

  const { workout, summary } = loaded;
  const jumpRope = summary.kind === 'JUMP_ROPING';
  const swim = summary.swim;
  // `formatWorkoutDistance` returns "2.34 km"; the summary shows the number big and the unit small.
  const [distance, distanceUnit] = formatWorkoutDistance(workout.distance).split(' ');
  const swimRows: { label: string; value: string | null }[] = swim
    ? [
        { label: 'Style', value: swim.style ?? null },
        { label: 'Laps', value: swim.laps !== undefined ? String(swim.laps) : null },
        { label: 'Pool length', value: swim.poolLengthCm !== undefined ? `${swim.poolLengthCm / 100} m` : null },
        { label: 'Strokes', value: swim.strokes !== undefined ? String(swim.strokes) : null },
        { label: 'Stroke rate', value: swim.avgStrokeRate !== undefined ? `${swim.avgStrokeRate} /min` : null },
        { label: 'SWOLF', value: swim.avgSwolf !== undefined ? String(swim.avgSwolf) : null },
      ].filter((row) => row.value !== null)
    : [];

  return (
    <Screen>
      <Stack.Screen options={{ title: workout.sportName }} />
      <Card>
        <View style={styles.summaryHead}>
          <IconChip icon={sportIcon(workout.sportName)} tint="workouts" size="lg" />
          <View style={styles.summaryTitle}>
            <AppText variant="heading" numberOfLines={2}>
              {workout.sportName}
            </AppText>
            <AppText variant="caption" muted>
              {formatDateTime(workout.start)}
            </AppText>
          </View>
        </View>
        <View style={styles.figures}>
          <Figure label="Duration">
            <Metric value={formatElapsed(workout.duration)} size="lg" />
          </Figure>
          {workout.distance > 0 ? (
            <Figure label="Distance">
              <Metric value={distance} unit={distanceUnit} size="lg" />
            </Figure>
          ) : null}
          {workout.calories > 0 ? (
            <Figure label="Calories">
              <Metric value={formatCount(workout.calories)} unit="kcal" size="lg" />
            </Figure>
          ) : null}
          {workout.steps > 0 ? (
            <Figure label={jumpRope ? 'Jumps' : 'Steps'}>
              <Metric value={formatCount(workout.steps)} size="lg" />
            </Figure>
          ) : null}
        </View>
        {workout.avgHr !== null || workout.maxHr !== null ? (
          <View style={styles.tiles}>
            {workout.avgHr !== null ? (
              <StatTile icon="heart" tint="heart" label="Avg heart rate" value={String(workout.avgHr)} unit="bpm" />
            ) : null}
            {workout.maxHr !== null ? (
              <StatTile icon="heart" tint="heart" label="Max heart rate" value={String(workout.maxHr)} unit="bpm" />
            ) : null}
          </View>
        ) : null}
      </Card>

      <Section title="Details" icon="list">
        <KeyValue
          icon="time-outline"
          label="Time of day"
          value={`${formatClock(workout.start)} to ${formatClock(workout.end)}`}
        />
        {paceRows(summary).map((row) => (
          <KeyValue key={row.label} icon="speedometer-outline" label={row.label} value={row.value} />
        ))}
        {summary.minHr !== undefined ? (
          <KeyValue icon="heart-outline" label="Lowest heart rate" value={`${summary.minHr} bpm`} />
        ) : null}
        {summary.elevationGain !== undefined ? (
          <KeyValue icon="trending-up-outline" label="Elevation gain" value={metres(summary.elevationGain)} />
        ) : null}
        {summary.elevationLoss !== undefined ? (
          <KeyValue icon="trending-down-outline" label="Elevation loss" value={metres(summary.elevationLoss)} />
        ) : null}
        {summary.maxAltitude !== undefined ? (
          <KeyValue icon="chevron-up-circle-outline" label="Highest point" value={metres(summary.maxAltitude)} />
        ) : null}
        {summary.minAltitude !== undefined ? (
          <KeyValue icon="chevron-down-circle-outline" label="Lowest point" value={metres(summary.minAltitude)} />
        ) : null}
        {summary.maxDepth !== undefined ? (
          <KeyValue icon="water-outline" label="Maximum depth" value={metres(summary.maxDepth)} />
        ) : null}
        {summary.aerobicEffect !== undefined ? (
          <KeyValue icon="fitness-outline" label="Aerobic training effect" value={summary.aerobicEffect.toFixed(1)} />
        ) : null}
        {summary.anaerobicEffect !== undefined ? (
          <KeyValue icon="fitness-outline" label="Anaerobic training effect" value={summary.anaerobicEffect.toFixed(1)} />
        ) : null}
        {summary.workoutLoad !== undefined ? (
          <KeyValue icon="barbell-outline" label="Workout load" value={String(summary.workoutLoad)} />
        ) : null}
        {summary.recoveryHours !== undefined ? (
          <KeyValue icon="bed-outline" label="Recovery time" value={`${summary.recoveryHours.toFixed(0)} h`} />
        ) : null}
        {summary.vo2max !== undefined ? (
          <KeyValue icon="pulse-outline" label="VO2 max" value={`${summary.vo2max} ml/kg/min`} />
        ) : null}
        {!workout.complete ? (
          <Notice icon="cloud-download-outline">Partly downloaded; the next sync fetches the rest.</Notice>
        ) : null}
        {summary.missingData ? (
          <Notice>The watch refused to return some data for this workout, so parts may be missing.</Notice>
        ) : null}
      </Section>

      <Section title="Route" icon="map" tint="workouts">
        <RouteView route={route} />
        {summary.gps === 'failed' ? (
          <Notice icon="location-outline">The watch did not provide a GPS file for this workout.</Notice>
        ) : null}
      </Section>

      <Section title="Heart rate" icon="heart" tint="heart">
        <HeartRateChart points={loaded.points} start={workout.start} end={workout.end} />
      </Section>

      {splits.length > 0 ? (
        <Section title="Splits" icon="flag">
          {splits.map((split, i) => (
            <KeyValue
              key={i}
              label={`${split.km.toFixed(split.km % 1 === 0 ? 0 : 2)} km`}
              value={formatPace(split.pace, 'km')}
            />
          ))}
        </Section>
      ) : null}

      {swimRows.length > 0 ? (
        <Section title="Swimming" icon="water" tint="workouts">
          {swimRows.map((row) => (
            <KeyValue key={row.label} label={row.label} value={row.value} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** A small label over one summary number. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.figure}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitle: { flex: 1, gap: 2 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xl, rowGap: spacing.md },
  figure: { gap: 2 },
  tiles: { flexDirection: 'row', gap: spacing.md },
});
