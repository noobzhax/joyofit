import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import type { DaySeries } from '@/features/trends/series';
import { useColors } from '@/theme';

const HEIGHT = 72;
const PAD = 6;
const DOT = 3;

interface Point {
  x: number;
  y: number;
}

interface TrendChartProps {
  /** One value per day, oldest first; null leaves a gap. */
  values: DaySeries;
  kind: 'line' | 'bar';
  color: string;
  /** Local midnight of the first day, for the axis. */
  firstDay: number;
  /** Fixed value range (recovery 0..100, strain 0..21); otherwise it follows the data. Bars always start at 0. */
  domain?: readonly [number, number];
  /** A second, dashed line drawn over the bars, one value per day (the sleep need). */
  reference?: readonly number[];
  /** Dashed horizontal line at the range's average. */
  average?: number | null;
  label: string;
}

/**
 * Days as a line or bars on a shared x axis. Days without a value are gaps: a line is cut there, never drawn across,
 * and a lone day is a dot. Dots mark only lone days and the newest day, so 90 days stay readable.
 */
export function TrendChart({ values, kind, color, firstDay, domain, reference, average, label }: TrendChartProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);

  const present = values.flatMap((v) => (v === null ? [] : [v]));
  const all = reference ? [...present, ...reference] : present;
  let lo = domain ? domain[0] : Math.min(...all);
  let hi = domain ? domain[1] : Math.max(...all);
  if (kind === 'bar') lo = 0;
  else if (!domain) {
    // Pad so the extremes do not sit on the frame; a flat series sits in the middle.
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo || 1;
  const n = values.length;
  const inner = Math.max(0, width - 2 * PAD);
  const slot = inner / n;
  const x = (i: number) => PAD + slot * (i + 0.5);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (HEIGHT - 2 * PAD);

  // Runs of consecutive days with a value.
  const runs: Point[][] = [];
  if (kind === 'line') {
    values.forEach((v, i) => {
      if (v === null) {
        if (runs.length > 0 && runs[runs.length - 1].length > 0) runs.push([]);
        return;
      }
      if (runs.length === 0) runs.push([]);
      runs[runs.length - 1].push({ x: x(i), y: y(v) });
    });
  }
  const lastIndex = values.findLastIndex((v) => v !== null);
  const barWidth = Math.max(1.5, Math.min(14, slot * 0.68));
  const first = new Date(firstDay * 1000);

  return (
    <View accessible accessibilityLabel={label} style={styles.wrap}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.chart}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            <Line x1={PAD} x2={width - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke={colors.hairline} strokeWidth={1} />
            {kind === 'bar'
              ? values.map((v, i) =>
                  v === null ? null : (
                    <Rect
                      key={i}
                      x={x(i) - barWidth / 2}
                      y={y(Math.min(v, hi))}
                      width={barWidth}
                      height={Math.max(1.5, HEIGHT - PAD - y(Math.min(v, hi)))}
                      rx={Math.min(3, barWidth / 2)}
                      fill={color}
                    />
                  ),
                )
              : null}
            {kind === 'line' && average !== null && average !== undefined ? (
              <Line
                x1={PAD}
                x2={width - PAD}
                y1={y(average)}
                y2={y(average)}
                stroke={colors.mutedForeground}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.6}
              />
            ) : null}
            {runs
              .filter((run) => run.length > 1)
              .map((run, i) => (
                <Polyline
                  key={i}
                  points={run.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            {kind === 'line'
              ? values.map((v, i) => {
                  if (v === null) return null;
                  const lone = values[i - 1] == null && values[i + 1] == null;
                  if (!lone && i !== lastIndex) return null;
                  return (
                    <Circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={DOT}
                      fill={i === lastIndex ? color : colors.card}
                      stroke={color}
                      strokeWidth={2}
                    />
                  );
                })
              : null}
            {reference ? (
              <Polyline
                points={reference.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={colors.foreground}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.7}
              />
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis}>
        <AppText variant="caption" muted>
          {first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
