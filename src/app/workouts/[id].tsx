import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import {
  getWorkout,
  listWorkoutPoints,
  type WorkoutPointRow,
  type WorkoutRow,
} from '@/db/queries';
import { HeartRateChart } from '@/features/workouts/HeartRateChart';
import { RouteView } from '@/features/workouts/RouteView';
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
        <AppText variant="caption" muted danger={error !== null}>
          {error ?? 'Loading'}
        </AppText>
      </Screen>
    );
  }

  const { workout, summary } = loaded;
  const jumpRope = summary.kind === 'JUMP_ROPING';
  const swim = summary.swim;
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
      <Section title={`${workout.sportName}, ${formatDateTime(workout.start)}`}>
        <KeyValue label="Duration" value={formatElapsed(workout.duration)} />
        <KeyValue label="Time of day" value={`${formatClock(workout.start)} to ${formatClock(workout.end)}`} />
        {workout.distance > 0 ? <KeyValue label="Distance" value={formatWorkoutDistance(workout.distance)} /> : null}
        {paceRows(summary).map((row) => (
          <KeyValue key={row.label} label={row.label} value={row.value} />
        ))}
        {workout.calories > 0 ? <KeyValue label="Calories" value={`${formatCount(workout.calories)} kcal`} /> : null}
        {workout.steps > 0 ? (
          <KeyValue label={jumpRope ? 'Jumps' : 'Steps'} value={formatCount(workout.steps)} />
        ) : null}
        {workout.avgHr !== null ? <KeyValue label="Average heart rate" value={`${workout.avgHr} bpm`} /> : null}
        {workout.maxHr !== null ? <KeyValue label="Highest heart rate" value={`${workout.maxHr} bpm`} /> : null}
        {summary.minHr !== undefined ? <KeyValue label="Lowest heart rate" value={`${summary.minHr} bpm`} /> : null}
        {summary.elevationGain !== undefined ? (
          <KeyValue label="Elevation gain" value={metres(summary.elevationGain)} />
        ) : null}
        {summary.elevationLoss !== undefined ? (
          <KeyValue label="Elevation loss" value={metres(summary.elevationLoss)} />
        ) : null}
        {summary.maxAltitude !== undefined ? <KeyValue label="Highest point" value={metres(summary.maxAltitude)} /> : null}
        {summary.minAltitude !== undefined ? <KeyValue label="Lowest point" value={metres(summary.minAltitude)} /> : null}
        {summary.maxDepth !== undefined ? <KeyValue label="Maximum depth" value={metres(summary.maxDepth)} /> : null}
        {summary.aerobicEffect !== undefined ? (
          <KeyValue label="Aerobic training effect" value={summary.aerobicEffect.toFixed(1)} />
        ) : null}
        {summary.anaerobicEffect !== undefined ? (
          <KeyValue label="Anaerobic training effect" value={summary.anaerobicEffect.toFixed(1)} />
        ) : null}
        {summary.workoutLoad !== undefined ? <KeyValue label="Workout load" value={String(summary.workoutLoad)} /> : null}
        {summary.recoveryHours !== undefined ? (
          <KeyValue label="Recovery time" value={`${summary.recoveryHours.toFixed(0)} h`} />
        ) : null}
        {summary.vo2max !== undefined ? <KeyValue label="VO2 max" value={`${summary.vo2max} ml/kg/min`} /> : null}
        {!workout.complete ? (
          <AppText variant="caption" muted>
            Partly downloaded; the next sync fetches the rest.
          </AppText>
        ) : null}
        {summary.missingData ? (
          <AppText variant="caption" muted>
            The watch refused to return some data for this workout, so parts may be missing.
          </AppText>
        ) : null}
      </Section>

      <Section title="Route">
        <RouteView route={route} />
        {summary.gps === 'failed' ? (
          <AppText variant="caption" muted>
            The watch did not provide a GPS file for this workout.
          </AppText>
        ) : null}
      </Section>

      <Section title="Heart rate">
        <HeartRateChart points={loaded.points} start={workout.start} end={workout.end} />
      </Section>

      {splits.length > 0 ? (
        <Section title="Splits">
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
        <Section title="Swimming">
          {swimRows.map((row) => (
            <KeyValue key={row.label} label={row.label} value={row.value} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
