import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Screen';
import type { HrvReadingRow } from '@/db/queries';
import { spacing } from '@/theme';

const DISMISSED_KEY = 'morning_checkin_dismissed_day';
const NOON_HOUR = 12;

/** Local calendar day as `yyyy-MM-dd`, the unit the dismissal is stored in. */
function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** True before noon local time, with no 1-minute (spot) HRV reading since local midnight. */
export function checkinDue(hrv: readonly HrvReadingRow[], dayStart: number, nowMs: number): boolean {
  if (new Date(nowMs).getHours() >= NOON_HOUR) return false;
  return !hrv.some((r) => r.source === 'spot' && r.end >= dayStart);
}

interface MorningCheckinProps {
  hrv: readonly HrvReadingRow[];
  dayStart: number;
  nowMs: number;
  connected: boolean;
  onMeasure: () => void;
}

/** One small prompt under the scores: shown in the morning while the watch is connected and today has no spot HRV. */
export function MorningCheckin({ hrv, dayStart, nowMs, connected, onMeasure }: MorningCheckinProps) {
  const today = localDayKey(nowMs);
  // undefined until the stored value is read, so the card does not flash for a day already dismissed.
  const [dismissedDay, setDismissedDay] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Storage.getItemAsync(DISMISSED_KEY).then(
      (value) => {
        if (!cancelled) setDismissedDay(value);
      },
      () => {
        if (!cancelled) setDismissedDay(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!connected || dismissedDay === undefined || dismissedDay === today || !checkinDue(hrv, dayStart, nowMs)) {
    return null;
  }

  const dismiss = () => {
    setDismissedDay(today);
    Storage.setItemAsync(DISMISSED_KEY, today).catch(() => undefined);
  };

  return (
    <Card>
      <View style={styles.body}>
        <AppText variant="bodyStrong">Morning check-in</AppText>
        <AppText variant="caption" muted>
          Measure HRV for 1 minute to add a reading for today.
        </AppText>
        <View style={styles.actions}>
          <Button label="Measure HRV" icon="pulse" onPress={onMeasure} />
          <Button label="Not today" variant="ghost" onPress={dismiss} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
