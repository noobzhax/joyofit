import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { Card, Screen, Section } from '@/components/Screen';
import { EmptyState, LoadingState, Notice } from '@/components/States';
import {
  FACE_MODE_ROWS,
  MAX_OPTION_INDEX,
  isEditable,
  styleIndex,
  visibleOptions,
  withStyle,
  withWidget,
} from '@/features/watchfaces/faceCustomModel';
import { useFaceCustomization } from '@/features/watchfaces/useFaceCustomization';
import { spacing } from '@/theme';

/** Options are numbered 1, 2, 3 ... from the watch's 0-based indexes; the watch sends no names and no counts. */
function OptionPicker({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  const [extra, setExtra] = useState(0);
  const count = visibleOptions(selected, extra);
  return (
    <View style={styles.picker}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {Array.from({ length: count }, (_, index) => (
          <Chip
            key={index}
            role="radio"
            label={String(index + 1)}
            selected={index === selected}
            onPress={() => !disabled && onSelect(index)}
          />
        ))}
        {count <= MAX_OPTION_INDEX ? <Chip label="More" selected={false} onPress={() => setExtra((e) => e + 4)} /> : null}
      </View>
    </View>
  );
}

/** Edits the options of a face that is already on the watch: style, background, typeface, hands, colour and widget slots. */
export function FaceCustomizeScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { connected, draft, setDraft, busy, error, notice, dirty, revertable, load, apply, revert } = useFaceCustomization(id);
  const idle = busy === null;

  if (!connected) {
    return (
      <Screen>
        <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
          Connect your watch to customize its faces.
        </Notice>
      </Screen>
    );
  }

  if (draft === null) {
    return (
      <Screen>
        {busy === 'load' ? (
          <LoadingState label="Asking the watch for this face's options..." />
        ) : (
          <>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Card>
              <EmptyState
                icon="color-palette"
                title="No options read"
                description="The watch answers only for faces that have options to edit. Make sure the face is one of those, then try again."
                action={{ label: 'Try again', icon: 'refresh', onPress: () => void load() }}
              />
            </Card>
          </>
        )}
      </Screen>
    );
  }

  const modes = FACE_MODE_ROWS.filter((row) => styleIndex(draft, row.mode) !== null);
  const hasColour = draft.colourIndex !== null;

  return (
    <Screen>
      <View style={styles.title}>
        <AppText variant="title" accessibilityRole="header">
          {name ?? `Face ${id}`}
        </AppText>
        <AppText variant="caption" muted>
          Face {id}
        </AppText>
      </View>

      <Notice icon="information-circle">
        The watch reports which option is selected, not how many exist or what they are called, so choices are numbered
        by position. Pick one, press Apply, and look at the watch. A number the face does not have is refused and the
        message says so.
      </Notice>
      {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {!isEditable(draft) ? (
        <Card>
          <EmptyState
            icon="color-palette"
            title="Nothing to edit"
            description="The watch reported this face but none of its options."
          />
        </Card>
      ) : null}

      {modes.length > 0 ? (
        <Section title="Look" icon="color-palette">
          {modes.map((row) => (
            <OptionPicker
              key={row.mode}
              label={row.title}
              selected={styleIndex(draft, row.mode)}
              disabled={!idle}
              onSelect={(index) => setDraft(withStyle(draft, row.mode, index))}
            />
          ))}
        </Section>
      ) : null}

      {hasColour ? (
        <Section title="Colour" icon="color-fill">
          <OptionPicker
            label="Palette"
            selected={draft.colourIndex}
            disabled={!idle}
            onSelect={(index) => setDraft({ ...draft, colourIndex: index })}
          />
          <Field
            label="Custom colour"
            hint="Optional. Sent as text exactly as typed (for example #FF8800); the format the watch expects is not confirmed."
            value={draft.customColour ?? ''}
            editable={idle}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="#RRGGBB"
            onChangeText={(text) => setDraft({ ...draft, customColour: text.trim() === '' ? null : text.trim() })}
          />
        </Section>
      ) : null}

      {draft.widgets.length > 0 ? (
        <Section title="Widgets" icon="apps">
          {draft.widgets.map((option, slot) => (
            <OptionPicker
              key={slot}
              label={`Slot ${slot + 1}`}
              selected={option}
              disabled={!idle}
              onSelect={(index) => setDraft(withWidget(draft, slot, index))}
            />
          ))}
        </Section>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Apply"
          variant="primary"
          icon="checkmark-circle"
          disabled={!dirty || !idle}
          loading={busy === 'apply'}
          onPress={() => void apply()}
        />
        <Button
          label="Revert"
          icon="arrow-undo"
          disabled={!revertable || !idle}
          loading={busy === 'revert'}
          onPress={() => void revert()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { gap: 2 },
  picker: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
