import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice, Skeleton } from '@/components/States';
import { buildNights } from '@/features/sleep/nights';
import { STRAIN_MAX } from '@/features/today/strain';
import {
  hrvSeries,
  recoverySeries,
  seriesFromMap,
  sleepSeries,
  strainSeries,
  TREND_RANGES,
  type TrendRange,
} from '@/features/trends/series';
import { TrendCard } from '@/features/trends/TrendCard';
import { useTrendsData } from '@/features/trends/useTrendsData';
import { useWatch } from '@/state/WatchProvider';
import { spacing, radius } from '@/theme';

const RANGE_OPTIONS = TREND_RANGES.map((value) => ({ value, label: `${value} days` }));

function hoursMinutes(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Recovery, strain, sleep, HRV and resting heart rate per day over 30 or 90 days, from the stored history. */
export function TrendsScreen() {
  const { linkState, device, dataVersion, sync } = useWatch();
  const [range, setRange] = useState<TrendRange>(30);
  const { data, error } = useTrendsData(range, dataVersion);
  const canSync = linkState === 'connected' && device !== null;

  const trends = useMemo(() => {
    if (!data) return null;
    const { maxHr, strain } = data;
    return {
      days: data.days,
      maxHr,
      recovery: recoverySeries(data.days, data.hrv),
      hrvNight: hrvSeries(data.days, data.hrv, 'night'),
      hrvSpot: hrvSeries(data.days, data.hrv, 'spot'),
      resting: seriesFromMap(data.days, data.resting),
      strain: strainSeries(data.days, strain),
      sleep: sleepSeries(data.days, buildNights(data.sleep, []), strain),
    };
  }, [data]);

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title="Trends" />
      <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} />
      {error ? <Notice tone="danger">Could not read stored data: {error}</Notice> : null}
      {trends ? (
        <View style={styles.cards}>
          <TrendCard
            title="Recovery"
            tint="link"
            kind="line"
            values={trends.recovery}
            firstDay={trends.days[0]}
            domain={[0, 100]}
            format={(v) => `${Math.round(v)}%`}
            empty="No recovery yet. It needs HRV readings (a night with the watch on, or a 1-minute reading) and at least 4 earlier readings of the same kind in the 30 days before."
            note="Your HRV against your own 30-day baseline: 50% is your usual. An estimate, not medical advice."
          />
          <TrendCard
            title="Strain"
            tint="workouts"
            kind="bar"
            values={trends.strain}
            firstDay={trends.days[0]}
            domain={[0, STRAIN_MAX]}
            format={(v) => v.toFixed(1)}
            empty="No heart rate stored in this range. Wear the watch and sync."
            note={`Worked out from the heart rate the watch stored (max ${trends.maxHr} bpm). A day with little stored heart rate reads low.`}
          />
          <TrendCard
            title="Sleep"
            tint="sleep"
            kind="bar"
            values={trends.sleep.hours}
            firstDay={trends.days[0]}
            reference={trends.sleep.need}
            referenceNote="Dashed line: the sleep you needed, 7 h 30 min plus up to 1 h after a hard day."
            format={hoursMinutes}
            empty="No nights stored in this range. Wear the watch to bed and sync."
            note="Time asleep, naps under 3 h left out."
          />
          <TrendCard
            title="HRV, nights"
            tint="sleep"
            kind="line"
            values={trends.hrvNight}
            firstDay={trends.days[0]}
            format={(v) => `${Math.round(v)} ms`}
            empty="No night HRV stored. Wear the watch asleep and sync."
            note="RMSSD averaged over sleep, from the watch's own records."
          />
          <TrendCard
            title="HRV, 1-minute readings"
            tint="steps"
            kind="line"
            values={trends.hrvSpot}
            firstDay={trends.days[0]}
            format={(v) => `${Math.round(v)} ms`}
            empty="No 1-minute readings yet. Measure HRV for a minute to add one."
            note="RMSSD of readings you took yourself. They run at a different level than nights, so keep them apart."
          />
          <TrendCard
            title="Resting heart rate"
            tint="heart"
            kind="line"
            values={trends.resting}
            firstDay={trends.days[0]}
            format={(v) => `${Math.round(v)} bpm`}
            empty="No resting heart rate stored in this range. Wear the watch day and night and sync."
            note="The lowest resting value the watch reported each day."
          />
          <AppText variant="caption" muted>
            Days without data are left empty, not filled in.
          </AppText>
        </View>
      ) : error ? null : (
        <Skeleton width="100%" height={260} radius={radius.card} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cards: { gap: spacing.md },
});
