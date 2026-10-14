import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { AlarmEditor, type AlarmFormValues } from '@/features/alarms/AlarmEditor';
import {
  DEFAULT_SMART_ALARM,
  describeRepeat,
  firstFreeSlot,
  formatAlarmTime,
} from '@/features/alarms/alarmUtils';
import { useAlarms } from '@/features/alarms/useAlarms';
import { formatDateTime } from '@/format';
import { spacing, useColors } from '@/theme';
import { ALARM_SLOTS, type WatchAlarm, type WatchSmartAlarm } from '@/wear';

type Editing = { kind: 'event'; slot: number; isNew: boolean } | { kind: 'smart' } | null;

/**
 * Reads, edits, adds, deletes and enables the watch's alarms and its smart alarm. The watch has
 * five slots, so the list is bounded and stays in a plain scroll view.
 */
export function AlarmsScreen() {
  const router = useRouter();
  const colors = useColors();
  const { alarms, connected, busy, error, refresh, save } = useAlarms();
  const [editing, setEditing] = useState<Editing>(null);

  const writable = connected && alarms.supported && !busy;
  const free = firstFreeSlot(alarms.event);
  const smart = alarms.smart;

  const pushEvents = async (event: WatchAlarm[]) =>
    save({ event: [...event].sort((a, b) => a.slot - b.slot), smart: null });

  const pushSmart = async (smart: WatchSmartAlarm) => save({ event: alarms.event, smart });

  const saveEvent = async (slot: number, values: AlarmFormValues) => {
    const previous = alarms.event.find((alarm) => alarm.slot === slot);
    const next: WatchAlarm = {
      slot,
      enabled: previous?.enabled ?? true,
      hour: values.hour,
      minute: values.minute,
      repeat: values.repeat,
      name: values.name,
    };
    const ok = await pushEvents([...alarms.event.filter((alarm) => alarm.slot !== slot), next]);
    if (ok) setEditing(null);
  };

  const saveSmart = async (values: AlarmFormValues) => {
    const ok = await pushSmart({
      enabled: smart?.enabled ?? true,
      hour: values.hour,
      minute: values.minute,
      repeat: values.repeat,
      aheadMinutes: values.aheadMinutes,
    });
    if (ok) setEditing(null);
  };

  const editor = (() => {
    if (!editing) return null;
    if (editing.kind === 'smart') {
      const current = smart ?? DEFAULT_SMART_ALARM;
      return (
        <AlarmEditor
          kind="smart"
          initial={{ ...current, name: '' }}
          saving={busy}
          onSave={(values) => void saveSmart(values)}
          onCancel={() => setEditing(null)}
        />
      );
    }
    const { slot, isNew } = editing;
    const existing = alarms.event.find((alarm) => alarm.slot === slot);
    return (
      <AlarmEditor
        kind="event"
        initial={{
          hour: existing?.hour ?? 7,
          minute: existing?.minute ?? 0,
          repeat: existing?.repeat ?? 0,
          name: existing?.name ?? 'Alarm',
          aheadMinutes: 5,
        }}
        saving={busy}
        onSave={(values) => void saveEvent(slot, values)}
        onCancel={() => setEditing(null)}
        onDelete={
          isNew
            ? undefined
            : async () => {
                const ok = await pushEvents(alarms.event.filter((alarm) => alarm.slot !== slot));
                if (ok) setEditing(null);
              }
        }
      />
    );
  })();

  return (
    <Screen refresh={{ refreshing: busy && editing === null, onRefresh: () => void refresh(), enabled: connected }}>
      {!connected ? (
        <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
          Connect your watch to read and change its alarms.
        </Notice>
      ) : null}
      {connected && !alarms.supported ? <Notice>This watch did not report alarm support.</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Section
        title="Alarms"
        icon="alarm"
        trailing={
          <AppText variant="caption" muted>
            {alarms.event.length} of {ALARM_SLOTS}
          </AppText>
        }>
        {alarms.event.length === 0 && editing === null ? (
          <AppText variant="caption" muted>
            No alarms on the watch.
          </AppText>
        ) : null}
        {alarms.event.map((alarm, index) => (
          <View key={alarm.slot} style={styles.item}>
            {index > 0 ? <Divider /> : null}
            {editing?.kind === 'event' && editing.slot === alarm.slot ? (
              editor
            ) : (
              <View style={styles.row}>
                <View style={styles.top}>
                  <View style={styles.info}>
                    <AppText variant="figure">{formatAlarmTime(alarm.hour, alarm.minute)}</AppText>
                    <AppText variant="caption" muted numberOfLines={1}>
                      {alarm.name} · {describeRepeat(alarm.repeat)}
                    </AppText>
                  </View>
                  <Switch
                    accessibilityLabel={`Alarm ${formatAlarmTime(alarm.hour, alarm.minute)} on`}
                    value={alarm.enabled}
                    disabled={!writable}
                    onValueChange={(enabled) =>
                      void pushEvents(alarms.event.map((a) => (a.slot === alarm.slot ? { ...a, enabled } : a)))
                    }
                    trackColor={{ false: colors.switchOff, true: colors.primary }}
                    thumbColor={alarm.enabled ? colors.primaryForeground : colors.card}
                  />
                </View>
                <Button
                  label="Edit"
                  icon="create"
                  disabled={!writable}
                  style={styles.edit}
                  onPress={() => setEditing({ kind: 'event', slot: alarm.slot, isNew: false })}
                />
              </View>
            )}
          </View>
        ))}
        {editing?.kind === 'event' && editing.isNew ? (
          <View style={styles.item}>
            {alarms.event.length > 0 ? <Divider /> : null}
            {editor}
          </View>
        ) : null}
        <Button
          label="Add alarm"
          variant="primary"
          icon="add"
          disabled={!writable || free === null || editing !== null}
          onPress={() => free !== null && setEditing({ kind: 'event', slot: free, isNew: true })}
        />
        {free === null ? (
          <AppText variant="caption" muted>
            All {ALARM_SLOTS} slots are used. Delete one to add another.
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {alarms.updatedAt === null
            ? 'Not read from the watch yet.'
            : `Last read from the watch ${formatDateTime(alarms.updatedAt / 1000)}.`}
        </AppText>
        <Button
          label="Read from the watch"
          icon="refresh"
          disabled={!connected || busy}
          loading={busy && !editing}
          onPress={() => void refresh()}
        />
      </Section>

      {alarms.smartSupported ? (
        <Section title="Smart alarm" icon="moon" tint="sleep">
          <AppText variant="caption" muted>
            Wakes you at a light moment of sleep within the chosen window before the time. The watch
            keeps one smart alarm and cannot delete it, only switch it off.
          </AppText>
          {editing?.kind === 'smart' ? (
            editor
          ) : (
            <>
              <View style={styles.stack}>
                <AppText variant="figure">{smart ? formatAlarmTime(smart.hour, smart.minute) : 'Not set'}</AppText>
                {smart ? (
                  <AppText variant="caption" muted>
                    Up to {smart.aheadMinutes} min early · {describeRepeat(smart.repeat)}
                  </AppText>
                ) : null}
              </View>
              {smart ? (
                <SwitchRow
                  label="Smart alarm on"
                  value={smart.enabled}
                  disabled={!writable}
                  onValueChange={(enabled) => void pushSmart({ ...smart, enabled })}
                />
              ) : null}
              <Button
                label={smart ? 'Edit smart alarm' : 'Set smart alarm'}
                icon="create"
                disabled={!writable || editing !== null}
                onPress={() => setEditing({ kind: 'smart' })}
              />
            </>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.md },
  row: { gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: 2 },
  stack: { gap: 2 },
  edit: { alignSelf: 'flex-start' },
});
