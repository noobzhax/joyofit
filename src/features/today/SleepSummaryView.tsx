import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { EmptyState } from '@/components/States';
import { formatClock, formatDuration } from '@/format';
import type { SleepScoreRow } from '@/db/queries';
import { SleepScoreRing } from '@/features/sleep/SleepScoreRing';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import type { SleepSummary } from '@/features/today/stats';
import { radius, spacing, useColors } from '@/theme';

export function SleepSummaryView({ summary, score }: { summary: SleepSummary | null; score: SleepScoreRow | null }) {
  const colors = useColors();
  if (!summary) {
    return (
      <EmptyState
        icon="moon"
        title="No sleep stored"
        description="Nothing from the last 36 hours. Sync after waking up to see last night."
      />
    );
  }

  const hasStages = summary.byStage.length > 0;
  const awakeSeconds = summary.byStage.find((entry) => entry.stage === 'awake')?.seconds ?? 0;
  const headlineSeconds = hasStages ? summary.totalSeconds - awakeSeconds : summary.totalSeconds;
  const minutes = Math.round(headlineSeconds / 60);

  return (
    <View style={styles.wrap}>
      <View style={styles.headlineRow}>
        <View style={styles.headlineText}>
          <View accessible accessibilityLabel={`Slept ${formatDuration(headlineSeconds)}`} style={styles.headline}>
            {minutes >= 60 ? <Metric value={String(Math.floor(minutes / 60))} unit="h" size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} /> : null}
            <Metric value={String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, '0')} unit="min" size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} />
          </View>
          <AppText variant="caption" muted>
            {formatClock(summary.start)} to {formatClock(summary.end)}
            {hasStages ? ', time awake excluded' : ', segment durations added up'}
          </AppText>
        </View>
        {score ? <SleepScoreRing score={score} /> : null}
      </View>
      {hasStages ? (
        <>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.stageBar}>
            {summary.byStage.map((entry) => (
              <View key={entry.stage} style={{ flex: entry.seconds, backgroundColor: stageColor(entry.stage, colors) }} />
            ))}
          </View>
          {summary.byStage.map((entry) => (
            <View key={entry.stage} style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: stageColor(entry.stage, colors) }]} />
              <AppText variant="caption" style={styles.legendLabel}>
                {STAGE_LABELS[entry.stage]}
              </AppText>
              <AppText variant="caption" muted style={styles.tabular}>
                {Math.round((entry.seconds / summary.totalSeconds) * 100)}%
              </AppText>
              <AppText variant="label" style={[styles.legendValue, styles.tabular]}>
                {formatDuration(entry.seconds)}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" muted>
            Stages come from the watch&apos;s sleep data. Spans without a stage count only in the total.
          </AppText>
        </>
      ) : (
        <>
          {summary.byType.map((entry) => (
            <KeyValue
              key={entry.type}
              label={`Type ${entry.type}`}
              value={`${entry.count} ${entry.count === 1 ? 'segment' : 'segments'}, ${formatDuration(entry.seconds)}`}
            />
          ))}
          <AppText variant="caption" muted>
            Types are the raw state bytes from the watch. Their meanings are not decoded.
          </AppText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headlineText: { flex: 1, gap: spacing.sm },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  stageBar: { flexDirection: 'row', height: 14, gap: 2, borderRadius: radius.pill, overflow: 'hidden', marginVertical: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1 },
  legendValue: { minWidth: 72, textAlign: 'right' },
  tabular: { fontVariant: ['tabular-nums'] },
});
