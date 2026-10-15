import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { TrendChart } from '@/features/trends/TrendChart';
import { summarize, type DaySeries } from '@/features/trends/series';
import { spacing, tintColors, useColors, type Tint } from '@/theme';

interface TrendCardProps {
  title: string;
  tint: Tint;
  values: DaySeries;
  kind: 'line' | 'bar';
  /** Number with its unit, e.g. `62 ms`. */
  format: (value: number) => string;
  /** First day of the range, local midnight. */
  firstDay: number;
  domain?: readonly [number, number];
  reference?: readonly number[];
  /** Says what the dashed `reference` line is. */
  referenceNote?: string;
  /** Shown when the whole range has no value: what is missing and how to get it. */
  empty: string;
  /** What the value means or how it is computed; one short line. */
  note?: string;
}

function ago(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** One metric over the range: latest value, the range average, a chart, and an empty state that says what is missing. */
export function TrendCard({ title, tint, values, kind, format, firstDay, domain, reference, referenceNote, empty, note }: TrendCardProps) {
  const colors = useColors();
  const tinted = tintColors(colors, tint);
  const summary = summarize(values);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <AppText variant="bodyStrong" style={styles.title}>
          {title}
        </AppText>
        {summary ? (
          <View style={styles.latest}>
            <AppText variant="heading" color={tinted.text} style={styles.figure}>
              {format(summary.latest)}
            </AppText>
            <AppText variant="caption" muted>
              {ago(summary.daysAgo)}
            </AppText>
          </View>
        ) : null}
      </View>
      {summary ? (
        <>
          <AppText variant="caption" muted>
            Average {format(summary.average)} over {summary.count} of {values.length} days
          </AppText>
          <TrendChart
            values={values}
            kind={kind}
            color={tinted.base}
            firstDay={firstDay}
            domain={domain}
            reference={reference}
            average={summary.average}
            label={`${title}, last ${values.length} days. Latest ${format(summary.latest)} ${ago(summary.daysAgo)}, average ${format(summary.average)}.`}
          />
          <AppText variant="caption" muted>
            {[kind === 'line' ? 'Dashed line: your average.' : null, referenceNote, note].filter(Boolean).join(' ')}
          </AppText>
        </>
      ) : (
        <AppText variant="caption" muted>
          {empty}
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  title: { flex: 1 },
  latest: { alignItems: 'flex-end' },
  figure: { fontVariant: ['tabular-nums'] },
});
