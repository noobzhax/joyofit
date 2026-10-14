import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { errorMessage } from '@/format';
import { radius, usePalette } from '@/theme';
import { HuaweiWear, type UserProfile, type UserSex } from '@/wear';

const DEFAULT_PROFILE: UserProfile = {
  heightCm: 175,
  weightKg: 70,
  birthYear: 1990,
  sex: 'unknown',
  dailyStepGoal: 8000,
};

const SEXES: readonly { value: UserSex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unknown', label: 'Unspecified' },
];

interface Fields {
  height: string;
  weight: string;
  birthYear: string;
  steps: string;
}

/** Parses the form; returns the first validation message when any field is out of range. */
function parseFields(fields: Fields, sex: UserSex): UserProfile | string {
  const height = Number(fields.height.trim());
  if (!Number.isInteger(height) || height < 100 || height > 250) {
    return 'Height must be a whole number from 100 to 250 cm.';
  }
  const weight = Number(fields.weight.trim().replace(',', '.'));
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
    return 'Weight must be from 20 to 300 kg.';
  }
  const currentYear = new Date().getFullYear();
  const birthYear = Number(fields.birthYear.trim());
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
    return `Birth year must be a whole number from 1900 to ${currentYear}.`;
  }
  const dailyStepGoal = Number(fields.steps.trim());
  if (!Number.isInteger(dailyStepGoal) || dailyStepGoal < 1000 || dailyStepGoal > 100000) {
    return 'Daily step goal must be a whole number from 1000 to 100000.';
  }
  return { heightCm: height, weightKg: Math.round(weight * 10) / 10, birthYear, sex, dailyStepGoal };
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  decimal?: boolean;
}

function NumberField({ label, value, onChangeText, decimal }: FieldProps) {
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
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        style={[styles.input, { borderColor: palette.border, color: palette.text }]}
      />
    </View>
  );
}

export function ProfileSection() {
  const [initial] = useState(() => HuaweiWear.getUserProfile() ?? DEFAULT_PROFILE);
  const [fields, setFields] = useState<Fields>({
    height: String(initial.heightCm),
    weight: String(initial.weightKg),
    birthYear: String(initial.birthYear),
    steps: String(initial.dailyStepGoal),
  });
  const [sex, setSex] = useState<UserSex>(initial.sex);
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const edit = (key: keyof Fields) => (text: string) => {
    setFields((current) => ({ ...current, [key]: text }));
    setMessage(null);
  };

  const save = async () => {
    const parsed = parseFields(fields, sex);
    if (typeof parsed === 'string') {
      setMessage({ text: parsed, danger: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const sent = await HuaweiWear.setUserProfile(parsed);
      setMessage({
        text: sent ? 'Sent to the watch.' : 'Saved. It is sent the next time the watch connects.',
        danger: false,
      });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Profile and goal">
      <AppText variant="caption" muted>
        The watch uses these for calories and its step goal. Nothing is sent to the watch until you
        save.
      </AppText>
      <NumberField label="Height (cm)" value={fields.height} onChangeText={edit('height')} />
      <NumberField label="Weight (kg)" value={fields.weight} onChangeText={edit('weight')} decimal />
      <NumberField label="Birth year" value={fields.birthYear} onChangeText={edit('birthYear')} />
      <View style={styles.field}>
        <AppText variant="caption" muted>
          Sex
        </AppText>
        <Segmented
          options={SEXES}
          value={sex}
          onChange={(next) => {
            setSex(next);
            setMessage(null);
          }}
        />
      </View>
      <NumberField label="Daily step goal" value={fields.steps} onChangeText={edit('steps')} />
      {message ? (
        <AppText variant="caption" danger={message.danger} muted={!message.danger} selectable>
          {message.text}
        </AppText>
      ) : null}
      <Button label="Save" variant="primary" onPress={save} loading={saving} />
    </Section>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    fontSize: 15,
  },
});
