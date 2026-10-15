import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { IconChip } from '@/components/IconChip';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { Card, Screen, Section } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { EmptyState } from '@/components/States';
import { BurnFigure, FuelBar } from '@/features/live/FuelBar';
import {
  distanceParts,
  elapsedSec,
  heartZone,
  paceValue,
  prefersSpeed,
  STATUS_LABELS,
} from '@/features/live/liveWorkout';
import { sportIcon } from '@/features/workouts/sportIcon';
import { formatElapsed } from '@/features/workouts/summary';
import { formatCount } from '@/format';
import { useNow } from '@/hooks/useNow';
import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import { radius, spacing, useColors } from '@/theme';
import { HuaweiWear, type LiveWorkout } from '@/wear';

const TICK_MS = 1_000;
const DASH = '--';

/** A workout started on the watch, as it happens: time, heart rate, distance, pace, calories, and fat and carbs burned. */
export function LiveWorkoutScreen() {
  const live = useLiveWorkout();
  const router = useRouter();

  if (!live) {
    return (
      <Screen>
        <HiddenTabHeader title="Live workout" />
        <EmptyState
          icon="walk"
          title="No workout running"
          description="An outdoor walk, run or ride started on the watch opens this screen by itself. For an indoor workout, start it on the watch and tap Start here."
          action={{ label: 'Start', icon: 'play', onPress: () => HuaweiWear.startLiveWorkout() }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <HiddenTabHeader title={live.sportName ?? 'Live workout'} />
      <LiveBody live={live} />
      {live.status === 'ended' ? (
        <Button
          label="Done"
          variant="primary"
          icon="checkmark"
          onPress={() => {
            HuaweiWear.dismissLiveWorkout();
            router.replace('/workouts');
          }}
        />
      ) : live.source !== 'watch' ? (
        <Button label="Finish" icon="stop" onPress={() => HuaweiWear.finishLiveWorkout()} />
      ) : null}
    </Screen>
  );
}

function LiveBody({ live }: { live: LiveWorkout }) {
  const colors = useColors();
  const nowMs = useNow(TICK_MS);
  const seconds = elapsedSec(live, nowMs);
  const zone = live.heartRate !== null ? heartZone(live.heartRate, live.maxHeartRate) : null;
  const distance = live.distanceM !== null ? distanceParts(live.distanceM) : null;
  const speed = prefersSpeed(live);
  const statusColor = live.status === 'running' ? colors.link : live.status === 'paused' ? colors.warning : colors.mutedForeground;

  return (
    <>
      <Card>
        <View style={styles.head}>
          <IconChip icon={sportIcon(live.sportName ?? '')} tint="workouts" size="lg" />
          <View style={styles.headText}>
            <AppText variant="heading" numberOfLines={1}>
              {live.sportName ?? 'Workout'}
            </AppText>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: statusColor }]} />
              <AppText variant="label" color={statusColor}>
                {STATUS_LABELS[live.status]}
              </AppText>
            </View>
          </View>
        </View>
        <View accessible accessibilityLabel={`Time ${formatElapsed(seconds)}`} style={styles.clock}>
          <Metric value={live.durationSec === null ? DASH : formatElapsed(seconds)} size="hero" />
        </View>
        <View style={styles.heartRow}>
          <Metric
            value={live.heartRate !== null ? String(live.heartRate) : DASH}
            unit="bpm"
            size="lg"
            color={colors.heartText}
            unitColor={colors.mutedForeground}
          />
          {zone ? (
            <View style={[styles.zone, { backgroundColor: colors.heartSoft }]}>
              <AppText variant="label" color={colors.heartText}>
                Zone {zone.zone} · {zone.label}
              </AppText>
            </View>
          ) : null}
        </View>
      </Card>

      <Section title="Burned so far" icon="flame" tint="workouts">
        <View style={styles.burnRow}>
          <BurnFigure label="Fat" grams={live.fatGrams} color={colors.workoutsText} />
          <BurnFigure label="Carbs" grams={live.carbGrams} color={colors.stepsText} />
          <View style={styles.burnFigure}>
            <AppText variant="label" muted>
              Calories
            </AppText>
            <Metric value={live.calories !== null ? formatCount(Math.round(live.calories)) : DASH} unit="kcal" size="md" />
          </View>
        </View>
        <FuelBar fatShare={live.fatShare} lead="Right now" />
        <AppText variant="caption" muted>
          An estimate by JoyoFit, the watch does not measure it: each calorie is split by your heart rate at that moment, with a
          maximum of {live.maxHeartRate} bpm (220 minus your age from the profile). Easier effort burns a larger share of fat.
          {live.source !== 'watch'
            ? ' The watch sends no live calories to JoyoFit, so they too come from its live heart rate, your weight, age and sex (Keytel 2005); the watch screen may differ.'
            : ''}
        </AppText>
      </Section>

      <View style={styles.tiles}>
        <StatTile icon="trail-sign" tint="steps" label="Distance" value={distance?.value ?? DASH} unit={distance?.unit} />
        {speed ? (
          <StatTile icon="speedometer" tint="steps" label="Speed" value={live.speedKmh !== null ? live.speedKmh.toFixed(1) : DASH} unit="km/h" />
        ) : (
          <StatTile icon="speedometer" tint="steps" label="Pace" value={live.paceSecPerKm ? paceValue(live.paceSecPerKm) : DASH} unit="/km" />
        )}
      </View>

      <Section title="Details" icon="list">
        {live.steps !== null ? <KeyValue icon="footsteps" label="Steps" value={formatCount(live.steps)} /> : null}
        {live.stepRate !== null ? <KeyValue icon="pulse" label="Cadence" value={`${live.stepRate} steps/min`} /> : null}
        {live.cadence !== null && live.cadence > 0 ? <KeyValue icon="bicycle" label="Cadence" value={`${live.cadence} rpm`} /> : null}
        {speed ? null : live.speedKmh !== null ? <KeyValue icon="speedometer" label="Speed" value={`${live.speedKmh.toFixed(1)} km/h`} /> : null}
        {live.altitudeM !== null ? <KeyValue icon="triangle" label="Altitude" value={`${live.altitudeM} m`} /> : null}
        {live.riseM !== null ? <KeyValue icon="trending-up" label="Climb" value={`${live.riseM} m`} /> : null}
        {live.descentM !== null ? <KeyValue icon="trending-down" label="Descent" value={`${live.descentM} m`} /> : null}
        {live.aerobicTe !== null ? <KeyValue icon="heart" label="Aerobic training effect" value={live.aerobicTe.toFixed(1)} /> : null}
        {live.anaerobicTe !== null ? <KeyValue icon="flash" label="Anaerobic training effect" value={live.anaerobicTe.toFixed(1)} /> : null}
        {live.durationSec === null ? (
          <AppText variant="caption" muted>
            Waiting for the first numbers from the watch.
          </AppText>
        ) : null}
        {live.status === 'ended' ? (
          <AppText variant="caption" muted>
            The full record (route, splits, heart-rate chart) arrives with the next sync and appears under Workouts.
          </AppText>
        ) : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clock: { alignItems: 'center', paddingVertical: spacing.sm },
  heartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  zone: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  burnRow: { flexDirection: 'row', gap: spacing.md },
  burnFigure: { flex: 1, gap: 2 },
  tiles: { flexDirection: 'row', gap: spacing.md },
});
