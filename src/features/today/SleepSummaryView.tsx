import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { formatClock, formatDuration } from '@/format';
import type { SleepStageSummary, SleepSummary } from '@/features/today/stats';

const STAGE_LABELS: Record<SleepStageSummary['stage'], string> = {
  light: 'Light',
  deep: 'Deep',
  rem: 'REM',
  awake: 'Awake',
};

export function SleepSummaryView({ summary }: { summary: SleepSummary | null }) {
  if (!summary) {
    return (
      <AppText variant="caption" muted>
        No sleep segments stored from the last 36 hours. Sync after waking up to see last night.
      </AppText>
    );
  }

  const hasStages = summary.byStage.length > 0;
  const awakeSeconds = summary.byStage.find((entry) => entry.stage === 'awake')?.seconds ?? 0;
  const headlineSeconds = hasStages ? summary.totalSeconds - awakeSeconds : summary.totalSeconds;

  return (
    <View style={{ gap: 8 }}>
      <AppText variant="figure">{formatDuration(headlineSeconds)}</AppText>
      <AppText variant="caption" muted>
        {formatClock(summary.start)} to {formatClock(summary.end)}
        {hasStages ? ', time awake excluded' : ', segment durations added up'}
      </AppText>
      {hasStages ? (
        <>
          {summary.byStage.map((entry) => (
            <KeyValue key={entry.stage} label={STAGE_LABELS[entry.stage]} value={formatDuration(entry.seconds)} />
          ))}
          <AppText variant="caption" muted>
            Stages come from the sleep data on the watch; spans without a stage are only in the total.
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
            Types are the raw state bytes from the watch; their meanings are not decoded.
          </AppText>
        </>
      )}
    </View>
  );
}
