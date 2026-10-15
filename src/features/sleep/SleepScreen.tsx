import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Metric } from '@/components/Metric';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { listAllSleep, listSleepScores, listStepSamplesSince } from '@/db/queries';
import { HourlyStages } from '@/features/sleep/HourlyStages';
import { Hypnogram } from '@/features/sleep/Hypnogram';
import { buildNights, hourlyStages, NIGHT_STAGES, type Night } from '@/features/sleep/nights';
import { SleepScoreRing } from '@/features/sleep/SleepScoreRing';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import { sleepNeedSec } from '@/features/today/readiness';
import { startOfLocalDay } from '@/features/today/stats';
import { dailyStrain } from '@/features/today/strain';
import { DEFAULT_AGE, maxHeartRate } from '@/features/workouts/substrate';
import { errorMessage, formatClock, formatDuration } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';
import { HIT, radius, spacing, useColors } from '@/theme';

/** Stage changes listed before "Show all"; a night has 30 to 60. */
const CHANGES_PREVIEW = 8;
/** Nights in the "Earlier nights" list. */
const HISTORY_ROWS = 14;

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
const SHORT_DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };

/** One night at a time: stages over the night, minutes per stage per hour, every stage change, and earlier nights. */
export function SleepScreen() {
  const db = useSQLiteContext();
  const colors = useColors();
  const { linkState, device, dataVersion, sync } = useWatch();
  const [nights, setNights] = useState<Night[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAllChanges, setShowAllChanges] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([listAllSleep(db), listSleepScores(db)]).then(
        ([segments, scores]) => {
          if (!cancelled) {
            setNights(buildNights(segments, scores));
            setError(null);
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  // Newest first; a selection that disappeared (data re-synced) falls back to the newest night.
  const index = Math.max(0, nights?.findIndex((n) => n.start === selected) ?? 0);
  const night = nights?.[index] ?? null;
  const hours = useMemo(() => (night ? hourlyStages(night) : []), [night]);
  const need = useNightNeed(night && !night.nap ? night.start : null);

  const select = (next: Night) => {
    setSelected(next.start);
    setShowAllChanges(false);
  };

  const canSync = linkState === 'connected' && device !== null;
  const refresh = { refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync };

  if (error !== null || nights === null || night === null) {
    return (
      <Screen refresh={refresh}>
        <HiddenTabHeader title="Sleep" />
        {error !== null ? (
          <Notice tone="danger">Could not read stored sleep: {error}</Notice>
        ) : nights === null ? (
          <>
            <Skeleton width="100%" height={88} radius={radius.card} />
            <Skeleton width="100%" height={220} radius={radius.card} />
          </>
        ) : (
          <EmptyState icon="moon" title="No sleep stored" description="Wear the watch to bed, then sync after waking up." />
        )}
      </Screen>
    );
  }

  const changes = night.periods.slice(1).map((p, i) => ({ at: p.start, from: night.periods[i].stage, to: p.stage, gap: p.start - night.periods[i].end }));
  const shownPeriods = showAllChanges ? night.periods : night.periods.slice(0, CHANGES_PREVIEW);
  const stages = NIGHT_STAGES.filter((stage) => night.seconds[stage] > 0);
  const recorded = night.asleepSeconds + night.seconds.awake;
  const minutes = Math.round(night.asleepSeconds / 60);
  const dateLabel = new Date(night.end * 1000).toLocaleDateString(undefined, DATE_FORMAT);

  return (
    <Screen refresh={refresh}>
      <HiddenTabHeader title="Sleep" />

      <View style={styles.picker}>
        <StepButton
          icon="chevron-back"
          label="Earlier night"
          disabled={index >= nights.length - 1}
          onPress={() => select(nights[index + 1])}
        />
        <View style={styles.pickerText} accessibilityLiveRegion="polite">
          <AppText variant="heading" numberOfLines={1}>
            {dateLabel}
          </AppText>
          <AppText variant="caption" muted>
            {night.nap ? 'Nap' : 'Night'}, {formatClock(night.start)} to {formatClock(night.end)}
          </AppText>
        </View>
        <StepButton icon="chevron-forward" label="Later night" disabled={index === 0} onPress={() => select(nights[index - 1])} />
      </View>

      <Section title={night.nap ? 'Nap' : 'Sleep'} icon="moon" tint="sleep">
        <View style={styles.headlineRow}>
          <View accessible accessibilityLabel={`Asleep ${formatDuration(night.asleepSeconds)}`} style={styles.headline}>
            {minutes >= 60 ? <Metric value={String(Math.floor(minutes / 60))} unit="h" size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} /> : null}
            <Metric value={String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, '0')} unit="min" size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} />
          </View>
          {night.score ? <SleepScoreRing score={night.score} /> : null}
        </View>
        <AppText variant="caption" muted>
          Asleep, time awake excluded. {night.awakenings} {night.awakenings === 1 ? 'time' : 'times'} awake during the night, {changes.length} stage{' '}
          {changes.length === 1 ? 'change' : 'changes'}.
          {night.score ? ` Score from the watch${night.score.efficiency !== null ? `, ${night.score.efficiency}% of the time in bed asleep` : ''}.` : ''}
        </AppText>
        {need ? (
          <AppText variant="caption">
            Needed {formatDuration(need.seconds)}
            {need.strain !== null ? ` after a strain of ${need.strain.toFixed(1)} that day` : ''}, got{' '}
            {Math.round((night.asleepSeconds / need.seconds) * 100)}%.
          </AppText>
        ) : null}
        {stages.map((stage) => (
          <View key={stage} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: stageColor(stage, colors) }]} />
            <AppText variant="caption" style={styles.legendLabel}>
              {STAGE_LABELS[stage]}
            </AppText>
            <AppText variant="caption" muted style={styles.tabular}>
              {Math.round((night.seconds[stage] / recorded) * 100)}%
            </AppText>
            <AppText variant="label" style={[styles.legendValue, styles.tabular]}>
              {formatDuration(night.seconds[stage])}
            </AppText>
          </View>
        ))}
      </Section>

      <Section title="Stages through the night" icon="analytics" tint="sleep">
        <Hypnogram night={night} />
      </Section>

      <Section title="Each hour" icon="bar-chart" tint="sleep">
        <HourlyStages hours={hours} />
        <AppText variant="caption" muted>
          A full bar is 60 minutes; grey is time with nothing recorded.
        </AppText>
      </Section>

      <Section title="Stage changes" icon="swap-vertical" tint="sleep" trailing={<AppText variant="caption" muted>{changes.length}</AppText>}>
        {shownPeriods.map((p, i) => (
          <View key={p.start}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.changeRow}>
              <AppText variant="label" style={[styles.changeTime, styles.tabular]}>
                {formatClock(p.start)}
              </AppText>
              <View style={[styles.swatch, { backgroundColor: stageColor(p.stage, colors) }]} />
              <AppText variant="body" style={styles.changeStage}>
                {i === 0 ? `Start, ${STAGE_LABELS[p.stage]}` : `${STAGE_LABELS[night.periods[i - 1].stage]} to ${STAGE_LABELS[p.stage]}`}
                {i > 0 && changes[i - 1].gap > 0 ? ` (${formatDuration(changes[i - 1].gap)} not recorded)` : ''}
              </AppText>
              <AppText variant="caption" muted style={styles.tabular}>
                {formatDuration(p.end - p.start)}
              </AppText>
            </View>
          </View>
        ))}
        {night.periods.length > CHANGES_PREVIEW ? (
          <Button
            label={showAllChanges ? 'Show fewer' : `Show all ${night.periods.length}`}
            variant="ghost"
            onPress={() => setShowAllChanges((v) => !v)}
          />
        ) : null}
      </Section>

      <Section title="Earlier nights" icon="calendar" tint="sleep">
        {nights.slice(0, HISTORY_ROWS).map((n, i) => {
          const current = n.start === night.start;
          return (
            <View key={n.start}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                accessibilityLabel={`${new Date(n.end * 1000).toLocaleDateString(undefined, DATE_FORMAT)}, ${n.nap ? 'nap' : 'night'}, asleep ${formatDuration(n.asleepSeconds)}${n.score ? `, score ${n.score.score}` : ''}`}
                onPress={() => select(n)}
                style={[styles.historyRow, current && { backgroundColor: colors.sleepSoft }]}>
                <View style={styles.historyText}>
                  <AppText variant={current ? 'bodyStrong' : 'body'} numberOfLines={1}>
                    {new Date(n.end * 1000).toLocaleDateString(undefined, SHORT_DATE_FORMAT)}
                    {n.nap ? ', nap' : ''}
                  </AppText>
                  <View style={styles.miniBar}>
                    {NIGHT_STAGES.filter((s) => n.seconds[s] > 0).map((s) => (
                      <View key={s} style={{ flex: n.seconds[s], backgroundColor: stageColor(s, colors) }} />
                    ))}
                  </View>
                </View>
                {n.score ? (
                  <AppText variant="caption" color={colors.sleepText} style={styles.tabular}>
                    {n.score.score}
                  </AppText>
                ) : null}
                <AppText variant="label" style={[styles.tabular, styles.historyDuration]}>
                  {formatDuration(n.asleepSeconds)}
                </AppText>
              </Pressable>
            </View>
          );
        })}
      </Section>
    </Screen>
  );
}

/**
 * The sleep a night needed: 7 h 30 min plus up to 1 h after the strain of the day it started on (see `readiness.ts`).
 * `strain` is null when that day has no stored heart rate; the base need still applies.
 */
function useNightNeed(nightStart: number | null): { seconds: number; strain: number | null } | null {
  const db = useSQLiteContext();
  const [need, setNeed] = useState<{ start: number; seconds: number; strain: number | null } | null>(null);
  useEffect(() => {
    if (nightStart === null) return;
    let cancelled = false;
    // A night that starts after midnight belongs to the day before it.
    const day = startOfLocalDay(nightStart - 6 * 3600);
    void listStepSamplesSince(db, day).then((samples) => {
      if (cancelled) return;
      const birthYear = HuaweiWear.getUserProfile()?.birthYear;
      const maxHr = maxHeartRate(birthYear ? new Date().getFullYear() - birthYear : DEFAULT_AGE);
      const strain = dailyStrain(samples.filter((s) => s.timestamp < nightStart), maxHr).find((d) => d.day === day)?.strain ?? null;
      setNeed({ start: nightStart, seconds: sleepNeedSec(strain), strain });
    });
    return () => {
      cancelled = true;
    };
  }, [db, nightStart]);
  return need && need.start === nightStart ? need : null;
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, { backgroundColor: colors.card, opacity: disabled ? 0.4 : 1 }]}>
      <Ionicons name={icon} size={22} color={colors.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  picker: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickerText: { flex: 1, alignItems: 'center', gap: 2 },
  step: { width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
  headlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1 },
  legendValue: { minWidth: 72, textAlign: 'right' },
  tabular: { fontVariant: ['tabular-nums'] },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  changeTime: { width: 48 },
  changeStage: { flex: 1 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, borderRadius: radius.input, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm },
  historyText: { flex: 1, gap: 6 },
  historyDuration: { minWidth: 76, textAlign: 'right' },
  miniBar: { flexDirection: 'row', height: 6, gap: 1, borderRadius: radius.pill, overflow: 'hidden' },
});
