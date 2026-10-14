import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Divider, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { BlockEditor } from '@/features/courses/BlockEditor';
import {
  blockLabel,
  buildCourse,
  formatMetres,
  formatSeconds,
  MAX_NAME_BYTES,
  newBlock,
  newIntervalGroup,
  newStep,
  PRESETS,
  summarize,
  type BlockDraft,
  type CourseDraft,
  type Preset,
  type StepDraft,
} from '@/features/courses/courseModel';
import { useCourseDraft } from '@/features/courses/useCourseDraft';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';
import { HuaweiWear, type RunningCoursePushResult } from '@/wear';

type Outcome = { kind: 'sent'; result: RunningCoursePushResult } | { kind: 'failed'; message: string } | null;

/** `list` with the item at `index` moved one place, or unchanged at either end. */
function moved<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The experimental running-course editor: build blocks of steps, check them against the contract's ranges and send the
 * course to the watch. The draft is kept on the phone. Nothing here is verified on a real watch.
 */
export function CourseEditorScreen() {
  const router = useRouter();
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const { draft, setDraft, loaded, saveError } = useCourseDraft();
  const [courses, setCourses] = useState(() => HuaweiWear.getCourses());
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useNativeRefresh(useCallback(() => setCourses(HuaweiWear.getCourses()), []));

  const built = useMemo(() => buildCourse(draft), [draft]);
  const summary = useMemo(() => summarize(draft), [draft]);

  /** Every edit goes through here so a result for an older version of the course is never left on screen. */
  const edit = (update: (previous: CourseDraft) => CourseDraft) => {
    setOutcome(null);
    setDraft(update);
  };

  const editBlock = (blockId: string, update: (block: BlockDraft) => BlockDraft) =>
    edit((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === blockId ? update(b) : b)) }));

  const confirmReplace = (title: string, apply: () => void) => {
    if (draft.blocks.length === 0) return apply();
    Alert.alert(title, 'This replaces the steps you have now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Replace', style: 'destructive', onPress: apply },
    ]);
  };

  const applyPreset = (preset: Preset) =>
    confirmReplace(`Use "${preset.name}"?`, () =>
      edit((d) => ({ ...preset.build(), name: d.name.trim() || preset.name })),
    );

  const send = async () => {
    if (built.course === null) return;
    setSending(true);
    setOutcome(null);
    try {
      setOutcome({ kind: 'sent', result: await HuaweiWear.pushRunningCourse(built.course) });
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
      const message = errorMessage(e);
      setOutcome({
        kind: 'failed',
        message: typeof code === 'string' && !message.includes(code) ? `${message} (${code})` : message,
      });
    } finally {
      setSending(false);
      setCourses(HuaweiWear.getCourses());
    }
  };

  if (!loaded) return <LoadingState label="Opening your course" />;

  const touched = draft.name.trim() !== '' || draft.blocks.length > 0;
  const total = summary.total;
  const gate = (set: boolean) => `Huawei's gate: ${set ? 'set' : 'not set'}`;

  return (
    <>
      <Notice>Unverified: the course format comes from static analysis of Huawei Health. The watch may refuse it.</Notice>
      {!courses.enabled ? <Notice tone="danger">Running courses are switched off. Turn them on in Settings, Advanced.</Notice> : null}
      {saveError ? <Notice tone="danger">{`The draft could not be saved on this phone: ${saveError}`}</Notice> : null}

      <Section title="Course" icon="flag" tint="workouts">
        <Field
          label="Name"
          value={draft.name}
          onChangeText={(name) => edit((d) => ({ ...d, name }))}
          maxLength={MAX_NAME_BYTES}
          icon="pricetag"
          hint="Shown on the watch."
        />
        <AppText variant="label" muted>
          Start from a preset
        </AppText>
        <View style={styles.chips}>
          {PRESETS.map((preset) => (
            <Chip key={preset.name} label={preset.name} selected={false} onPress={() => applyPreset(preset)} />
          ))}
        </View>
        {summary.total ? (
          <>
            <Divider />
            <KeyValue icon="layers" label="Steps, repeats counted" value={String(summary.steps)} />
            <KeyValue
              icon="time"
              label="Total"
              value={
                total?.kind === 'time'
                  ? formatSeconds(total.value)
                  : total?.kind === 'distance'
                    ? formatMetres(total.value)
                    : total?.kind === 'mixed'
                      ? 'Mixed targets'
                      : 'No targets'
              }
            />
          </>
        ) : null}
      </Section>

      <Section title="Steps" icon="list" tint="workouts">
        {draft.blocks.length === 0 ? (
          <AppText variant="caption" muted>
            No steps yet. Add one, add an interval group, or start from a preset.
          </AppText>
        ) : null}
        {draft.blocks.map((block, index) => (
          <View key={block.id} style={styles.item}>
            {index > 0 ? <Divider /> : null}
            <BlockEditor
              label={blockLabel(draft, index)}
              block={block}
              isFirst={index === 0}
              isLast={index === draft.blocks.length - 1}
              onMove={(direction) => edit((d) => ({ ...d, blocks: moved(d.blocks, index, direction) }))}
              onRemove={() => edit((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== block.id) }))}
              onRepeat={(repeat) => editBlock(block.id, (b) => ({ ...b, repeat }))}
              onAddStep={() => editBlock(block.id, (b) => ({ ...b, steps: [...b.steps, newStep()] }))}
              onStepChange={(stepId: string, patch: Partial<StepDraft>) =>
                editBlock(block.id, (b) => ({
                  ...b,
                  steps: b.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
                }))
              }
              onStepMove={(stepId, direction) =>
                editBlock(block.id, (b) => ({
                  ...b,
                  steps: moved(
                    b.steps,
                    b.steps.findIndex((s) => s.id === stepId),
                    direction,
                  ),
                }))
              }
              onStepRemove={(stepId) =>
                editBlock(block.id, (b) => ({ ...b, steps: b.steps.filter((s) => s.id !== stepId) }))
              }
            />
          </View>
        ))}
        <Divider />
        <Button
          label="Add step"
          icon="add"
          variant="primary"
          onPress={() => edit((d) => ({ ...d, blocks: [...d.blocks, newBlock([newStep()])] }))}
        />
        <Button
          label="Add interval group"
          icon="repeat"
          onPress={() => edit((d) => ({ ...d, blocks: [...d.blocks, newIntervalGroup()] }))}
        />
        <AppText variant="caption" muted>
          An interval group is run 400 m at 5:00 to 5:30 per km, then rest 60 s, six times. Change anything.
        </AppText>
        {draft.blocks.length > 0 ? (
          <Button
            label="Clear all steps"
            icon="trash"
            variant="destructive"
            onPress={() => confirmReplace('Clear all steps?', () => edit((d) => ({ ...d, blocks: [] })))}
          />
        ) : null}
      </Section>

      <Section title="Send to watch" icon="send" tint="link">
        <KeyValue label="ExpandCapability 41" value={gate(courses.gate41)} />
        <KeyValue label="ExpandCapability 169" value={gate(courses.gate169)} />
        <AppText variant="caption" muted>
          Huawei Health needs 41 or 169 before it pushes a course. The watch decides whether it accepts one.
        </AppText>
        {!connected ? (
          <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
            Connect your watch to send a course.
          </Notice>
        ) : null}
        {built.error !== null ? (
          touched ? (
            <Notice tone="danger">{built.error}</Notice>
          ) : (
            <AppText variant="caption" muted>
              Add steps or pick a preset first.
            </AppText>
          )
        ) : null}
        <Button
          label="Send to watch"
          icon="send"
          variant="primary"
          loading={sending}
          disabled={!connected || !courses.enabled || built.course === null}
          onPress={() => void send()}
        />
        {outcome?.kind === 'sent' ? (
          <View style={styles.result}>
            <Notice icon="checkmark-circle">
              {outcome.result.uploadStatus === null
                ? 'Sent. The watch gave no upload status.'
                : `Sent. The watch said ${outcome.result.uploadStatus}.`}
            </Notice>
            <KeyValue label="Upload status" value={outcome.result.uploadStatus === null ? null : String(outcome.result.uploadStatus)} />
            <KeyValue label="Answered" value={outcome.result.answered ? 'Yes' : 'No'} />
            <KeyValue label="Answer" value={outcome.result.answerHex} />
            <KeyValue label="File" value={`${outcome.result.fileName}, ${outcome.result.bytes} bytes`} />
            <AppText variant="caption" muted>
              Huawei Health reads an upload status of 1 as accepted. Check the course on the watch.
            </AppText>
          </View>
        ) : null}
        {outcome?.kind === 'failed' ? <Notice tone="danger">{outcome.message}</Notice> : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.md },
  result: { gap: spacing.sm },
});
