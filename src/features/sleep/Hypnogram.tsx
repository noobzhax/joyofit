import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { NIGHT_STAGES, type Night, type NightStage } from '@/features/sleep/nights';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import { formatClock, formatDuration } from '@/format';
import { useColors } from '@/theme';

const ROW_HEIGHT = 34;
const BAR_INSET = 5;
const LABEL_WIDTH = 46;
const TICK_LABEL_WIDTH = 36;

/**
 * One row per stage, awake on top and deep at the bottom (deeper sleep sits lower), each period a bar on
 * its row, joined by thin verticals where the stage changes. Hour lines mark the local clock.
 */
export function Hypnogram({ night }: { night: Night }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);

  // A staged night always shows all four stage rows so nights line up; `asleep` only when the watch gave no stage.
  const staged = night.asleepSeconds + night.seconds.awake > night.seconds.asleep;
  const rows = NIGHT_STAGES.filter((stage) => night.seconds[stage] > 0 || (staged && stage !== 'asleep'));
  const rowOf = Object.fromEntries(rows.map((stage, i) => [stage, i])) as Record<NightStage, number>;
  const height = rows.length * ROW_HEIGHT;
  const span = Math.max(1, night.end - night.start);
  const x = (sec: number) => ((sec - night.start) / span) * width;
  const mid = (stage: NightStage) => rowOf[stage] * ROW_HEIGHT + ROW_HEIGHT / 2;

  const hours: number[] = [];
  const tick = new Date(night.start * 1000);
  tick.setMinutes(0, 0, 0);
  for (tick.setHours(tick.getHours() + 1); tick.getTime() / 1000 < night.end; tick.setHours(tick.getHours() + 1)) {
    hours.push(tick.getTime() / 1000);
  }
  // Labels every hour fit up to about 9 h on a phone; longer sessions label every other hour.
  const labelEvery = hours.length > 9 ? 2 : 1;

  const changes = night.periods.length - 1;
  const label =
    `Sleep stages from ${formatClock(night.start)} to ${formatClock(night.end)}, ${changes} stage ${changes === 1 ? 'change' : 'changes'}. ` +
    rows.map((stage) => `${STAGE_LABELS[stage]} ${formatDuration(night.seconds[stage])}`).join(', ');

  return (
    <View accessible accessibilityLabel={label} style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.labels, { height }]}>
          {rows.map((stage) => (
            <View key={stage} style={styles.rowLabel}>
              <AppText variant="caption" muted numberOfLines={1}>
                {STAGE_LABELS[stage]}
              </AppText>
            </View>
          ))}
        </View>
        <View style={[styles.plot, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Svg width={width} height={height}>
              {rows.map((stage, i) => (
                <Rect key={stage} x={0} y={i * ROW_HEIGHT + BAR_INSET} width={width} height={ROW_HEIGHT - 2 * BAR_INSET} fill={colors.muted} rx={4} />
              ))}
              {hours.map((sec) => (
                <Line key={sec} x1={x(sec)} x2={x(sec)} y1={0} y2={height} stroke={colors.hairline} strokeWidth={1} />
              ))}
              {night.periods.slice(1).map((p, i) => {
                const prev = night.periods[i];
                // Only a real hand-over gets a connector; a gap in the recording stays open.
                if (p.start !== prev.end) return null;
                return (
                  <Line
                    key={`c${p.start}`}
                    x1={x(p.start)}
                    x2={x(p.start)}
                    y1={mid(prev.stage)}
                    y2={mid(p.stage)}
                    stroke={colors.mutedForeground}
                    strokeOpacity={0.45}
                    strokeWidth={1}
                  />
                );
              })}
              {night.periods.map((p) => (
                <Rect
                  key={p.start}
                  x={x(p.start)}
                  y={rowOf[p.stage] * ROW_HEIGHT + BAR_INSET}
                  width={Math.max(1.5, x(p.end) - x(p.start))}
                  height={ROW_HEIGHT - 2 * BAR_INSET}
                  fill={stageColor(p.stage, colors)}
                  rx={2}
                />
              ))}
            </Svg>
          ) : null}
        </View>
      </View>
      <View style={styles.axisRow}>
        <View style={{ width: LABEL_WIDTH }} />
        <View style={styles.axis}>
          {width > 0
            ? hours.map((sec, i) =>
                i % labelEvery === 0 && x(sec) > TICK_LABEL_WIDTH / 2 && x(sec) < width - TICK_LABEL_WIDTH / 2 ? (
                  <AppText
                    key={sec}
                    variant="caption"
                    muted
                    numberOfLines={1}
                    style={[styles.tick, { left: x(sec) - TICK_LABEL_WIDTH / 2 }]}>
                    {new Date(sec * 1000).getHours()}
                  </AppText>
                ) : null,
              )
            : null}
        </View>
      </View>
      <View style={styles.ends}>
        <AppText variant="caption" muted>
          Fell asleep {formatClock(night.start)}
        </AppText>
        <AppText variant="caption" muted>
          Woke {formatClock(night.end)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row' },
  labels: { width: LABEL_WIDTH },
  rowLabel: { height: ROW_HEIGHT, justifyContent: 'center' },
  plot: { flex: 1 },
  axisRow: { flexDirection: 'row' },
  axis: { flex: 1, height: 18 },
  tick: { position: 'absolute', width: TICK_LABEL_WIDTH, textAlign: 'center', fontSize: 11, lineHeight: 15 },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
});
