import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { ReadinessSection } from '@/features/today/ReadinessSection';
import { computeScores } from '@/features/today/scores';
import { StrainSection } from '@/features/today/StrainSection';
import { useTodayData } from '@/features/today/useTodayData';
import { useWatch } from '@/state/WatchProvider';
import { radius, useColors } from '@/theme';

/** What the three rings on Today stand for, with every signal and the strain week behind them. */
export function ReadinessScreen() {
  const router = useRouter();
  const colors = useColors();
  const { linkState, device, dataVersion, sync } = useWatch();
  const { data, error } = useTodayData(dataVersion);
  const scores = useMemo(() => (data ? computeScores(data) : null), [data]);
  const canSync = linkState === 'connected' && device !== null;

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title="Readiness" />
      {error ? <Notice tone="danger">Could not read stored data: {error}</Notice> : null}
      {scores && data ? (
        <>
          <ReadinessSection readiness={scores.readiness} />
          <StrainSection days={scores.strain} dayStart={data.dayStart} maxHr={scores.maxHr} />
          <NavRow
            icon="stats-chart"
            tint="link"
            title="Trends"
            subtitle="Recovery, strain, sleep, HRV and resting heart rate over 30 or 90 days"
            onPress={() => router.push('/trends')}
            style={groupedRowStyle(colors, 0, 1)}
          />
        </>
      ) : error ? null : (
        <Skeleton width="100%" height={260} radius={radius.card} />
      )}
    </Screen>
  );
}
