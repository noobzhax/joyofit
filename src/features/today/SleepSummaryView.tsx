import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { formatClock, formatDuration } from '@/format';
import type { SleepSummary } from '@/features/today/stats';

export function SleepSummaryView({ summary }: { summary: SleepSummary | null }) {
  if (!summary) {
    return (
      <AppText variant="caption" muted>
        No sleep segments stored from the last 36 hours. Sync after waking up to see last night.
      </AppText>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="figure">{formatDuration(summary.totalSeconds)}</AppText>
      <AppText variant="caption" muted>
        {formatClock(summary.start)} to {formatClock(summary.end)}, segment durations added up
      </AppText>
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
    </View>
  );
}
