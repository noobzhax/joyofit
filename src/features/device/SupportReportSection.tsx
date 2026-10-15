import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Share } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { issueUrl, reportText } from '@/features/device/supportIssue';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

type Busy = 'github' | 'share' | null;

/**
 * JoyoFit is tested on one watch; owners of other models make it work on theirs by sending what their watch answered.
 * "Report on GitHub" opens a prefilled issue in the browser (the user reviews and submits it with their own account);
 * the log is too long for the link, so it goes to the clipboard to paste into the issue's Log field.
 */
export function SupportReportSection() {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const reportOnGitHub = () =>
    run('github', async () => {
      const report = await HuaweiWear.getSupportReport();
      await Clipboard.setStringAsync(reportText(report));
      setCopied(true);
      await Linking.openURL(issueUrl(report));
    });

  const shareText = () =>
    run('share', async () => {
      const report = await HuaweiWear.getSupportReport();
      await Share.share({ title: 'JoyoFit support report', message: reportText(report) });
    });

  return (
    <Section title="Help support your watch" icon="chatbubbles">
      <AppText variant="caption" muted>
        JoyoFit is tested on the Huawei Watch Fit 4 Pro. Other Huawei and Honor watches are experimental. If something
        does not work, connect once, then send a report. It lists what your watch answered on its last connect, without
        Bluetooth addresses or the serial number.
      </AppText>
      {copied ? (
        <Notice>
          The full report is on your clipboard. On GitHub, say what works and what does not, then paste the report into
          the Log field.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        label="Report on GitHub"
        variant="primary"
        icon="logo-github"
        loading={busy === 'github'}
        disabled={busy !== null}
        onPress={() => void reportOnGitHub()}
      />
      <Button
        label="Share as text"
        icon="share-social"
        loading={busy === 'share'}
        disabled={busy !== null}
        onPress={() => void shareText()}
      />
    </Section>
  );
}
