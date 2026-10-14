import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { DayChips } from '@/features/alarms/DayChips';
import { parseBounded } from '@/features/alarms/alarmUtils';
import { radius, usePalette } from '@/theme';

export interface AlarmFormValues {
  hour: number;
  minute: number;
  repeat: number;
  /** Event alarms only. */
  name: string;
  /** Smart alarm only: how many minutes before the time the watch may wake you. */
  aheadMinutes: number;
}

interface AlarmEditorProps {
  initial: AlarmFormValues;
  kind: 'event' | 'smart';
  saving: boolean;
  onSave: (values: AlarmFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  numeric?: boolean;
}

function Field({ label, value, onChangeText, numeric }: FieldProps) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={numeric ? 3 : 64}
        style={[styles.input, { borderColor: palette.border, color: palette.text }]}
      />
    </View>
  );
}

/** Time, days and (per kind) name or wake-up window of one alarm. Validation messages stay inside the form. */
export function AlarmEditor({ initial, kind, saving, onSave, onCancel, onDelete }: AlarmEditorProps) {
  const [hour, setHour] = useState(String(initial.hour));
  const [minute, setMinute] = useState(String(initial.minute));
  const [name, setName] = useState(initial.name);
  const [ahead, setAhead] = useState(String(initial.aheadMinutes));
  const [repeat, setRepeat] = useState(initial.repeat);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const h = parseBounded(hour, 0, 23);
    const m = parseBounded(minute, 0, 59);
    const a = parseBounded(ahead, 0, 127);
    if (h === null) return setProblem('Hour must be 0 to 23.');
    if (m === null) return setProblem('Minute must be 0 to 59.');
    if (kind === 'smart' && a === null) return setProblem('Wake-up window must be 0 to 127 minutes.');
    setProblem(null);
    onSave({
      hour: h,
      minute: m,
      repeat,
      name: name.trim() || 'Alarm',
      aheadMinutes: a ?? initial.aheadMinutes,
    });
  };

  return (
    <View style={styles.form}>
      <View style={styles.timeRow}>
        <View style={styles.time}>
          <Field label="Hour (0-23)" value={hour} onChangeText={setHour} numeric />
        </View>
        <View style={styles.time}>
          <Field label="Minute (0-59)" value={minute} onChangeText={setMinute} numeric />
        </View>
      </View>
      {kind === 'event' ? <Field label="Name" value={name} onChangeText={setName} /> : null}
      {kind === 'smart' ? (
        <Field label="Wake me up to this many minutes early" value={ahead} onChangeText={setAhead} numeric />
      ) : null}
      <AppText variant="caption" muted>
        Repeat (none selected means once)
      </AppText>
      <DayChips value={repeat} onChange={setRepeat} />
      {problem ? (
        <AppText variant="caption" danger>
          {problem}
        </AppText>
      ) : null}
      <Button label="Save to the watch" variant="primary" loading={saving} onPress={save} />
      <Button label="Cancel" disabled={saving} onPress={onCancel} />
      {onDelete ? <Button label="Delete alarm" variant="danger" disabled={saving} onPress={onDelete} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  timeRow: { flexDirection: 'row', gap: 12 },
  time: { flex: 1 },
  field: { gap: 4 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    fontSize: 15,
  },
});
