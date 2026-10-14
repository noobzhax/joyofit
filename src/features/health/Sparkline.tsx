import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import type { WeekPoint } from '@/features/health/metrics';
import { useColors } from '@/theme';

const HEIGHT = 56;
const PAD = 6;
const DOT = 3.5;

/** Daily means of the last seven days as a line; days without data leave a gap. Newest day is the filled end. */
export function Sparkline({ points, color, label }: { points: readonly WeekPoint[]; color: string; label: string }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);

  const means = points.flatMap((p) => (p.mean === null ? [] : [p.mean]));
  if (means.length === 0) return null;
  const lo = Math.min(...means);
  const hi = Math.max(...means);
  const span = hi - lo;
  const x = (i: number) => PAD + (points.length > 1 ? (i / (points.length - 1)) * (width - 2 * PAD) : 0);
  // A flat series sits in the middle instead of on the floor.
  const y = (v: number) => (span === 0 ? HEIGHT / 2 : PAD + (1 - (v - lo) / span) * (HEIGHT - 2 * PAD));

  // Runs of consecutive days with a value; a lone day is only a dot.
  const runs: { x: number; y: number }[][] = [];
  points.forEach((p, i) => {
    if (p.mean === null) {
      runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push({ x: x(i), y: y(p.mean) });
  });
  const lastIndex = points.length - 1;
  const first = new Date(points[0].dayStart * 1000);

  return (
    <View accessible accessibilityLabel={label} style={styles.wrap}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.chart}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {runs
              .filter((run) => run.length > 1)
              .map((run, i) => (
                <Polyline
                  key={i}
                  points={run.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            {points.map((p, i) =>
              p.mean === null ? null : (
                <Circle
                  key={p.dayStart}
                  cx={x(i)}
                  cy={y(p.mean)}
                  r={DOT}
                  fill={i === lastIndex ? color : colors.card}
                  stroke={color}
                  strokeWidth={2}
                />
              ),
            )}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis}>
        <AppText variant="caption" muted>
          {first.toLocaleDateString(undefined, { weekday: 'short' })}
        </AppText>
        <AppText variant="caption" muted>
          Today
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  chart: { height: HEIGHT },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
