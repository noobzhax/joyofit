import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Ring } from '@/components/Ring';
import { Card } from '@/components/Screen';
import type { Readiness } from '@/features/today/readiness';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { spacing, useColors } from '@/theme';

const SIZE = 84;
const STROKE = 7;

/**
 * Today at a glance: readiness, strain and sleep against need, side by side. The whole card opens the Readiness screen,
 * where each number is explained; Today itself stays short.
 */
export function ScoresCard({ readiness, today, onPress }: { readiness: Readiness; today: DayStrain | null; onPress: () => void }) {
  const colors = useColors();
  const sleep = readiness.signals.find((s) => s.key === 'sleep') ?? null;
  // The readiness ring fills with the share of signals that look good (neutral counts half); the word is the read.
  const fill = readiness.signals.length
    ? readiness.signals.reduce((a, s) => a + (s.tone === 'good' ? 1 : s.tone === 'neutral' ? 0.5 : 0), 0) / readiness.signals.length
    : 0;
  const readinessColor =
    readiness.headline === 'Primed' || readiness.headline === 'Balanced'
      ? colors.link
      : readiness.headline
        ? colors.heart
        : colors.mutedForeground;

  return (
    <Card>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open readiness, strain and sleep details"
        style={styles.row}>
        <Gauge
          label="Readiness"
          value={fill}
          max={1}
          color={readinessColor}
          track={colors.linkSoft}
          center={readiness.headline ?? '--'}
          small
        />
        <Gauge
          label="Strain"
          value={today?.strain ?? 0}
          max={STRAIN_MAX}
          color={colors.workouts}
          track={colors.workoutsSoft}
          center={today ? today.strain.toFixed(1) : '--'}
        />
        <Gauge
          label="Sleep"
          value={sleep?.amount ?? 0}
          max={1}
          color={colors.sleep}
          track={colors.sleepSoft}
          center={sleep ? sleep.value.replace(' ', '') : '--'}
        />
      </PressableScale>
    </Card>
  );
}

function Gauge(props: { label: string; value: number; max: number; color: string; track: string; center: string; small?: boolean }) {
  return (
    <View style={styles.gauge}>
      <Ring size={SIZE} stroke={STROKE} value={props.value} max={props.max} color={props.color} track={props.track} accessibilityLabel={`${props.label} ${props.center}`}>
        <AppText variant={props.small ? 'label' : 'heading'} numberOfLines={1} adjustsFontSizeToFit style={styles.center}>
          {props.center}
        </AppText>
      </Ring>
      <AppText variant="caption" muted>
        {props.label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  gauge: { flex: 1, alignItems: 'center', gap: spacing.xs },
  center: { maxWidth: SIZE - 2 * STROKE - 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
