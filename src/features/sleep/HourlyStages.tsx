import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { HourStages, NightStage } from '@/features/sleep/nights';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import { useColors } from '@/theme';

const BAR_AREA_HEIGHT = 120;
/** Stacking order from the floor up: deepest sleep at the bottom, awake on top. */
const STACK: readonly NightStage[] = ['deep', 'light', 'asleep', 'rem', 'awake'];

/** One bar per clock hour, full height = 60 minutes, split into the minutes of each stage. Plain Views. */
export function HourlyStages({ hours }: { hours: readonly HourStages[] }) {
  const colors = useColors();
  const labelEvery = hours.length > 10 ? 2 : 1;
  const label = hours
    .map((h) => {
      const parts = STACK.filter((s) => h.seconds[s] >= 60).map((s) => `${STAGE_LABELS[s]} ${Math.round(h.seconds[s] / 60)} min`);
      return `${new Date(h.hour * 1000).getHours()}:00, ${parts.length > 0 ? parts.join(', ') : 'no sleep recorded'}`;
    })
    .join('. ');

  return (
    <View accessible accessibilityLabel={`Minutes per stage for each hour. ${label}`} style={styles.wrap}>
      <View style={styles.bars}>
        {hours.map((h) => (
          <View key={h.hour} style={[styles.slot, { backgroundColor: colors.muted }]}>
            {STACK.map((stage) =>
              h.seconds[stage] > 0 ? (
                <View
                  key={stage}
                  style={{ height: (Math.min(h.seconds[stage], 3600) / 3600) * BAR_AREA_HEIGHT, backgroundColor: stageColor(stage, colors) }}
                />
              ) : null,
            )}
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        {hours.map((h, i) => (
          <View key={h.hour} style={styles.axisSlot}>
            {i % labelEvery === 0 ? (
              <AppText variant="caption" muted numberOfLines={1} style={styles.tick}>
                {new Date(h.hour * 1000).getHours()}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  bars: { flexDirection: 'row', height: BAR_AREA_HEIGHT, gap: 4 },
  // column-reverse stacks the first stage at the floor.
  slot: { flex: 1, flexDirection: 'column-reverse', borderRadius: 4, overflow: 'hidden' },
  axis: { flexDirection: 'row', gap: 4 },
  axisSlot: { flex: 1, alignItems: 'center' },
  tick: { fontSize: 11, lineHeight: 15 },
});
