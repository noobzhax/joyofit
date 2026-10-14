import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Divider, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { LoadingState, Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';
import { HuaweiWear, type CycleOverview, type CycleSwitches } from '@/wear';

const LEVELS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Light' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Heavy' },
] as const;

const CRAMPS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Strong' },
] as const;

/** `YYYY-MM-DD` plus `offset` days, computed on the calendar date so daylight saving never shifts it. */
function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offset));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** `Oct 14`, in the phone's language. */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SWITCH_ROWS: readonly { key: keyof CycleSwitches; label: string }[] = [
  { key: 'periodStart', label: 'Period is about to start' },
  { key: 'periodEnd', label: 'Period is about to end' },
  { key: 'fertileStart', label: 'Fertile window is about to start' },
  { key: 'fertileEnd', label: 'Fertile window is about to end' },
  { key: 'easyPregnancy', label: 'Easy-pregnancy reminders' },
];

/**
 * The menstrual cycle log: period start and end, flow, cramps, an average-cycle estimate of the next period, and the switch
 * that shows the calendar and reminders on the watch. Everything stays in the phone's own database.
 */
export function CycleScreen() {
  const [cycle, setCycle] = useState<CycleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pastStart, setPastStart] = useState('');
  const [pastEnd, setPastEnd] = useState('');

  const load = useCallback(async () => {
    try {
      setCycle(await HuaweiWear.getCycle());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useNativeRefresh(() => void load());

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!cycle) {
    return error ? <Notice tone="danger">{error}</Notice> : <LoadingState label="Loading your cycle log" />;
  }

  const selected = shiftDay(cycle.today, -offset);
  const logged = cycle.days.find((d) => d.day === selected);
  const flow = logged?.flow ?? 0;
  const cramps = logged?.cramps ?? 0;
  const next = cycle.predictions[0];
  const untilNext = next ? daysBetween(cycle.today, next.start) : null;
  const periods = [...cycle.periods].reverse().slice(0, 6);

  const setSwitch = (key: keyof CycleSwitches, value: boolean) =>
    run(() => HuaweiWear.setCycleSwitches({ ...cycle.switches, [key]: value }));

  return (
    <>
      <Notice>
        Dates for the next period and the fertile window are an estimate from the average of your logged cycles. They are not
        medical advice and cannot tell irregular cycles, illness, stress, hormones or pregnancy. Do not use them to avoid or plan a
        pregnancy.
      </Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Section title="Next period" icon="calendar" tint="heart">
        {next ? (
          <>
            <KeyValue
              icon="water"
              label="Estimated start"
              value={
                cycle.daysLate > 0
                  ? `${formatDay(next.start)} (${cycle.daysLate} day${cycle.daysLate === 1 ? '' : 's'} late)`
                  : `${formatDay(next.start)} (${untilNext === 0 ? 'today' : `in ${untilNext} days`})`
              }
            />
            <KeyValue icon="time" label="Estimated length" value={`${cycle.averagePeriodDays} days`} />
            <KeyValue
              icon="flower"
              label="Fertile window before it"
              value={`${formatDay(next.fertileStart)} to ${formatDay(next.fertileEnd)}`}
            />
            <KeyValue icon="repeat" label="Average cycle" value={`${cycle.averageCycleDays} days`} />
          </>
        ) : (
          <AppText variant="caption" muted>
            Log the first day of a period and JoyoFit estimates the next one. With one cycle it assumes 28 days, with more it
            averages them.
          </AppText>
        )}
      </Section>

      <Section title="Log" icon="create" tint="heart">
        <View style={styles.chips}>
          {[0, 1, 2].map((n) => (
            <Chip
              key={n}
              label={n === 0 ? 'Today' : n === 1 ? 'Yesterday' : formatDay(shiftDay(cycle.today, -n))}
              selected={offset === n}
              onPress={() => setOffset(n)}
            />
          ))}
        </View>
        {cycle.periodOngoing ? (
          <Button
            label={`Period ended ${offset === 0 ? 'today' : formatDay(selected)}`}
            variant="primary"
            icon="checkmark"
            disabled={busy}
            onPress={() => run(() => HuaweiWear.endPeriod(selected))}
          />
        ) : (
          <Button
            label={`Period started ${offset === 0 ? 'today' : formatDay(selected)}`}
            variant="primary"
            icon="water"
            disabled={busy}
            onPress={() => run(() => HuaweiWear.startPeriod(selected))}
          />
        )}
        <Divider />
        <AppText variant="label" muted>
          Flow on {offset === 0 ? 'today' : formatDay(selected)}
        </AppText>
        <Segmented
          options={LEVELS}
          value={flow}
          disabled={busy}
          onChange={(value) => run(() => HuaweiWear.logCycleDay(selected, value, cramps))}
        />
        <AppText variant="label" muted>
          Cramps
        </AppText>
        <Segmented
          options={CRAMPS}
          value={cramps}
          disabled={busy}
          onChange={(value) => run(() => HuaweiWear.logCycleDay(selected, flow, value))}
        />
      </Section>

      <Section title="Periods you logged" icon="list">
        {periods.length === 0 ? (
          <AppText variant="caption" muted>
            Nothing logged yet.
          </AppText>
        ) : (
          periods.map((p) => (
            <View key={p.start} style={styles.periodRow}>
              <View style={styles.periodText}>
                <AppText variant="bodyStrong">
                  {formatDay(p.start)}
                  {p.end ? ` to ${formatDay(p.end)}` : ' (going on)'}
                </AppText>
                {p.end ? (
                  <AppText variant="caption" muted>
                    {daysBetween(p.start, p.end) + 1} days
                  </AppText>
                ) : null}
              </View>
              <Button
                label="Delete"
                variant="destructive"
                disabled={busy}
                onPress={() => run(() => HuaweiWear.deletePeriod(p.start))}
              />
            </View>
          ))
        )}
        <Divider />
        <AppText variant="label" muted>
          Add an earlier period
        </AppText>
        <Field label="First day" placeholder="YYYY-MM-DD" value={pastStart} onChangeText={setPastStart} autoCapitalize="none" />
        <Field label="Last day" placeholder="YYYY-MM-DD" value={pastEnd} onChangeText={setPastEnd} autoCapitalize="none" />
        <Button
          label="Add period"
          icon="add"
          disabled={busy || pastStart.length !== 10 || pastEnd.length !== 10}
          onPress={() =>
            run(async () => {
              await HuaweiWear.addPeriod(pastStart, pastEnd);
              setPastStart('');
              setPastEnd('');
            })
          }
        />
      </Section>

      <Section title="On the watch" icon="watch">
        <SwitchRow
          icon="calendar"
          label="Show the cycle calendar on the watch"
          hint={
            cycle.watchSupported
              ? 'Sends your estimates and symptoms to the watch when it asks. Off by default.'
              : `Not available right now: ${cycle.watchNote}. It is sent on the next connection with a watch that supports it.`
          }
          value={cycle.enabled}
          disabled={busy}
          onValueChange={(enabled) => run(() => HuaweiWear.setCycleEnabled(enabled))}
        />
        {cycle.enabled ? (
          <>
            <Divider />
            <SwitchRow
              icon="notifications"
              label="Reminders on the watch"
              hint="Master switch for the reminders below."
              value={cycle.switches.master}
              disabled={busy}
              onValueChange={(value) => setSwitch('master', value)}
            />
            {SWITCH_ROWS.filter((row) => row.key !== 'easyPregnancy' || cycle.easyPregnancySwitch).map((row) => (
              <SwitchRow
                key={row.key}
                label={row.label}
                value={cycle.switches[row.key]}
                disabled={busy || !cycle.switches.master}
                onValueChange={(value) => setSwitch(row.key, value)}
              />
            ))}
          </>
        ) : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  periodText: { flex: 1, gap: 2 },
});
