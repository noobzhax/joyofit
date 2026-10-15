import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Ring } from '@/components/Ring';
import { Section } from '@/components/Screen';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { STRAIN_DAYS } from '@/features/today/useTodayData';
import { radius, spacing, useColors } from '@/theme';

const BAR_HEIGHT = 56;
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'narrow' };

function formatStrain(strain: number): string {
  return strain.toFixed(1);
}

/** Words for where a day's strain sits; the cut points split the 0..21 curve at roughly rest, walk, run, hard. */
export function strainWord(strain: number): string {
  if (strain < 5) return 'Light';
  if (strain < 10) return 'Moderate';
  if (strain < 14) return 'High';
  return 'All out';
}

/** Today's strain as a ring, minutes per zone, and the last seven days as bars. */
export function StrainSection({ days, dayStart, maxHr }: { days: readonly DayStrain[]; dayStart: number; maxHr: number }) {
  const colors = useColors();
  const byDay = new Map(days.map((d) => [d.day, d]));
  const week = Array.from({ length: STRAIN_DAYS }, (_, i) => {
    // Local midnights: step back a day at noon so a DST shift cannot land on the wrong date.
    const noon = new Date((dayStart + 12 * 3600) * 1000);
    noon.setDate(noon.getDate() - (STRAIN_DAYS - 1 - i));
    noon.setHours(0, 0, 0, 0);
    const day = Math.floor(noon.getTime() / 1000);
    return { day, strain: byDay.get(day)?.strain ?? null };
  });
  const today = byDay.get(dayStart) ?? null;
  const hard = today ? Math.round(today.zoneMinutes[2] + today.zoneMinutes[3] + today.zoneMinutes[4]) : 0;
  const easy = today ? Math.round(today.zoneMinutes[0] + today.zoneMinutes[1]) : 0;

  return (
    <Section title="Strain" icon="flash" tint="workouts">
      <View style={styles.row}>
        <Ring
          size={92}
          stroke={8}
          value={today?.strain ?? 0}
          max={STRAIN_MAX}
          color={colors.workouts}
          track={colors.workoutsSoft}
          accessibilityLabel={today ? `Strain ${formatStrain(today.strain)} of ${STRAIN_MAX}` : 'No strain yet today'}>
          <View style={styles.center}>
            <AppText variant="heading" color={colors.workoutsText} style={styles.value}>
              {today ? formatStrain(today.strain) : '--'}
            </AppText>
            <AppText variant="caption" muted style={styles.small}>
              of {STRAIN_MAX}
            </AppText>
          </View>
        </Ring>
        <View style={styles.text}>
          <AppText variant="bodyStrong">{today ? strainWord(today.strain) : 'No heart rate yet today'}</AppText>
          {today ? (
            <AppText variant="caption" muted>
              {hard} min above 70 % of max heart rate, {easy} min at 50 to 70 %.
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            From the heart rate the watch stored (max {maxHr} bpm). Sync to update.
          </AppText>
        </View>
      </View>
      <View style={styles.bars} accessibilityLabel="Strain over the last seven days">
        {week.map(({ day, strain }) => (
          <View key={day} style={styles.barCol}>
            <View style={[styles.barTrack, { backgroundColor: colors.workoutsSoft }]}>
              {strain !== null ? (
                <View
                  style={[
                    styles.barFill,
                    { height: Math.max(3, (BAR_HEIGHT * strain) / STRAIN_MAX), backgroundColor: day === dayStart ? colors.workouts : colors.workoutsText },
                  ]}
                />
              ) : null}
            </View>
            <AppText variant="caption" muted style={styles.small}>
              {strain !== null ? formatStrain(strain) : '-'}
            </AppText>
            <AppText variant="caption" muted style={styles.small}>
              {new Date(day * 1000).toLocaleDateString(undefined, WEEKDAY)}
            </AppText>
          </View>
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  center: { alignItems: 'center' },
  value: { fontVariant: ['tabular-nums'] },
  small: { fontSize: 11, lineHeight: 14 },
  text: { flex: 1, gap: 4 },
  bars: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  barCol: { alignItems: 'center', gap: 2, flex: 1 },
  barTrack: { width: 14, height: BAR_HEIGHT, borderRadius: radius.pill, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: radius.pill },
});
