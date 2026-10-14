import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { formatCount } from '@/format';
import { radius, usePalette } from '@/theme';

const BAR_AREA_HEIGHT = 96;
const LABEL_EVERY_HOURS = 6;

/** 24 bars, one per local hour, scaled to the busiest hour. Plain Views, no chart library. */
export function HourlyBars({ steps }: { steps: readonly number[] }) {
  const palette = usePalette();
  const peak = Math.max(...steps);
  const peakHour = steps.indexOf(peak);
  const summary =
    peak > 0
      ? `Steps per hour. Busiest hour ${peakHour}:00 with ${formatCount(peak)} steps.`
      : 'Steps per hour. No steps recorded today.';

  return (
    <View accessible accessibilityLabel={summary} style={styles.wrap}>
      <View style={styles.bars}>
        {steps.map((value, hour) => (
          <View key={hour} style={styles.slot}>
            <View
              style={{
                height: peak > 0 ? Math.max(value > 0 ? 2 : 0, (value / peak) * BAR_AREA_HEIGHT) : 0,
                backgroundColor: palette.accent,
                borderTopLeftRadius: radius.sm / 2,
                borderTopRightRadius: radius.sm / 2,
              }}
            />
          </View>
        ))}
      </View>
      <View style={[styles.axis, { borderTopColor: palette.border }]}>
        {steps.map((_, hour) => (
          <View key={hour} style={styles.slot}>
            {hour % LABEL_EVERY_HOURS === 0 || hour === 23 ? (
              <AppText variant="caption" muted style={styles.tick} numberOfLines={1}>
                {hour}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
      {peak > 0 ? (
        <AppText variant="caption" muted>
          Busiest hour {peakHour}:00, {formatCount(peak)} steps
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  bars: { flexDirection: 'row', height: BAR_AREA_HEIGHT, alignItems: 'flex-end', gap: 2 },
  axis: { flexDirection: 'row', gap: 2, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  slot: { flex: 1, justifyContent: 'flex-end' },
  tick: { width: 24, marginLeft: -6, textAlign: 'center', fontSize: 11 },
});
