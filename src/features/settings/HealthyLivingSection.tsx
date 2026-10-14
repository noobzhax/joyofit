import { useCallback, useMemo, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatAgo } from '@/format';
import { useNow } from '@/hooks/useNow';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

/** Keeps "asked 5 min ago" right while the screen stays open. */
const AGO_TICK_MS = 30_000;

const NOT_ASKED = 'The watch has not asked for tasks yet. Open Healthy Living on the watch once.';

/**
 * The Healthy Living tasks (Huawei Health's daily goals ring) on the watch. The watch asks for its
 * tasks over the P2P service; the switch decides whether the phone answers, the button pushes
 * today's tasks without waiting for a request.
 */
export function HealthyLivingSection() {
  const { linkState } = useWatch();
  const nowSec = Math.floor(useNow(AGO_TICK_MS) / 1000);
  // Re-read when the screen gains focus, an action ends, or the link changes (the gate and the registration follow the link).
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useNativeRefresh(refresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` and `linkState` are the triggers, the native read has no inputs
  const status = useMemo(() => HuaweiWear.getHealthyLiving(), [version, linkState]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <Section title="Healthy Living" icon="leaf" tint="link">
      <SwitchRow
        icon="checkmark-done"
        label="Answer the watch's Healthy Living requests"
        hint="On by default. Switching on takes effect on the next connect, switching off at once."
        value={status.enabled}
        disabled={busy}
        onValueChange={(enabled) => run(() => HuaweiWear.setHealthyLivingEnabled(enabled))}
      />
      <KeyValue icon="watch" label="Watch support" value={status.supported ? 'Supported' : 'Not supported'} />
      <AppText variant="caption" muted>
        {status.gate}
      </AppText>
      <KeyValue
        icon="time"
        label="Last request"
        value={status.lastRequestAt === null ? 'The watch has not asked yet' : `The watch has asked ${formatAgo(status.lastRequestAt / 1000, nowSec)}`}
      />
      <KeyValue icon="git-branch" label="Message version" value={status.msgVer === null ? null : String(status.msgVer)} />
      <KeyValue icon="document-text" label="Last report" value={status.lastReport} />
      <Button
        label="Send today to the watch"
        variant="secondary"
        icon="send"
        disabled={busy || !status.supported}
        onPress={() =>
          run(async () => {
            const sent = await HuaweiWear.pushHealthyLiving();
            setNote(sent ? 'Sent. Open Healthy Living on the watch to check.' : NOT_ASKED);
          })
        }
      />
      {note ? <Notice>{note}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <AppText variant="caption" muted>
        Unverified on the watch: based on Huawei Health&apos;s protocol.
      </AppText>
    </Section>
  );
}
