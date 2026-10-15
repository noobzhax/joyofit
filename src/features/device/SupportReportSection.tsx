import { useState } from 'react';
import { Share } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

/**
 * JoyoFit is tested on one watch; owners of other models make it work on theirs by sending what their watch answered.
 * The report is plain text through Android's share sheet, so the user sees it and picks where it goes.
 */
export function SupportReportSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await HuaweiWear.getSupportReport();
      await Share.share({ title: 'JoyoFit support report', message: report });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Help support your watch" icon="chatbubbles">
      <AppText variant="caption" muted>
        JoyoFit is tested on the Huawei Watch Fit 4 Pro. Other Huawei and Honor watches are experimental. If something
        does not work, connect once, then share this report. It lists what your watch answered on its last connect, without
        Bluetooth addresses or the serial number.
      </AppText>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Share support report" icon="share-social" loading={busy} onPress={() => void share()} />
    </Section>
  );
}
