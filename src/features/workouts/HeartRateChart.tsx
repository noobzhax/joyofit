import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { WorkoutPointRow } from '@/db/queries';
import { heartRateBuckets } from '@/features/workouts/summary';
import { formatClock } from '@/format';
import { radius, usePalette } from '@/theme';

const BAR_AREA_HEIGHT = 96;
const BUCKETS = 60;

/** Heart rate over the workout as 60 bars of averaged readings. Plain Views, no chart library. */
export function HeartRateChart({
  points,
  start,
  end,
}: {
  points: readonly WorkoutPointRow[];
  start: number;
  end: number;
}) {
  const palette = usePalette();
  const buckets = useMemo(() => heartRateBuckets(points, start, end, BUCKETS), [points, start, end]);

  if (!buckets) {
    return (
      <AppText variant="caption" muted>
        No heart-rate readings stored for this workout.
      </AppText>
    );
  }
  // The baseline sits below the lowest reading so a steady heart rate still shows its shape.
  const lo = Math.max(30, buckets.min - 10);
  const hi = Math.max(buckets.max, lo + 1);
  return (
    <View
      accessible
      accessibilityLabel={`Heart rate from ${buckets.min} to ${buckets.max} bpm`}
      style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.bars}>
          {buckets.values.map((value, i) => (
            <View key={i} style={styles.slot}>
              {value !== null ? (
                <View
                  style={{
                    height: Math.max(2, ((value - lo) / (hi - lo)) * BAR_AREA_HEIGHT),
                    backgroundColor: palette.accent,
                    borderTopLeftRadius: radius.sm / 2,
                    borderTopRightRadius: radius.sm / 2,
                  }}
                />
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.scale}>
          <AppText variant="caption" muted>
            {buckets.max}
          </AppText>
          <AppText variant="caption" muted>
            {lo}
          </AppText>
        </View>
      </View>
      <View style={[styles.axis, { borderTopColor: palette.border }]}>
        <AppText variant="caption" muted>
          {formatClock(start)}
        </AppText>
        <AppText variant="caption" muted>
          {formatClock(end)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  bars: { flex: 1, flexDirection: 'row', height: BAR_AREA_HEIGHT, alignItems: 'flex-end', gap: 1 },
  slot: { flex: 1, justifyContent: 'flex-end' },
  scale: { height: BAR_AREA_HEIGHT, justifyContent: 'space-between', alignItems: 'flex-end' },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
});
