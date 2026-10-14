import { useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

/** Makes the connected watch ring and vibrate so it can be found. */
export function FindWatchSection() {
  const { linkState } = useWatch();
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  const connected = linkState === 'connected' || linkState === 'syncing';
  const supported = connected && HuaweiWear.getPhoneFeatures().findWatchSupported;

  const send = async (start: boolean) => {
    setBusy(start ? 'start' : 'stop');
    setMessage(null);
    try {
      await HuaweiWear.findWatch(start);
      setMessage({ text: start ? 'Sent. The watch should ring now.' : 'Stop sent.', danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Find my watch" icon="locate">
      <AppText variant="caption" muted>
        Makes the watch ring and vibrate.
      </AppText>
      {!connected ? <Notice>Connect your watch first.</Notice> : null}
      {connected && !supported ? <Notice>This watch did not report find-device support.</Notice> : null}
      <Button
        label="Ring the watch"
        variant="primary"
        icon="volume-high"
        disabled={!supported}
        loading={busy === 'start'}
        onPress={() => void send(true)}
      />
      <Button
        label="Stop ringing"
        icon="volume-mute"
        disabled={!supported}
        loading={busy === 'stop'}
        onPress={() => void send(false)}
      />
      {message ? (
        <Notice tone={message.danger ? 'danger' : 'info'} icon={message.danger ? undefined : 'checkmark-circle'}>
          {message.text}
        </Notice>
      ) : null}
    </Section>
  );
}
