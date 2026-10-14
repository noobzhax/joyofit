import { useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
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
    <Section title="Find my watch">
      <AppText variant="caption">Makes the watch ring and vibrate.</AppText>
      {connected && !supported ? (
        <AppText variant="caption" muted>
          This watch did not report find-device support.
        </AppText>
      ) : null}
      <Button
        label="Ring the watch"
        variant="primary"
        disabled={!supported}
        loading={busy === 'start'}
        onPress={() => void send(true)}
      />
      <Button label="Stop ringing" disabled={!supported} loading={busy === 'stop'} onPress={() => void send(false)} />
      {message ? (
        <AppText variant="caption" danger={message.danger} muted={!message.danger} selectable>
          {message.text}
        </AppText>
      ) : null}
    </Section>
  );
}
