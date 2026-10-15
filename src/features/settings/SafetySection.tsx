import { useCallback, useState } from 'react';
import { Linking, PermissionsAndroid } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { HuaweiWear } from '@/wear';

const FALL_LABELS = { '-1': 'Not reported yet', '0': 'Off', '1': 'On' } as const;

/** Fall detection on the watch, the SOS SMS relay and the morning sleep report. */
export function SafetySection() {
  const [safety, setSafety] = useState(() => HuaweiWear.getSafety());
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const [sleepNote, setSleepNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setSafety(HuaweiWear.getSafety()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setTest(null);
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

  const toggleSos = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const permission = PermissionsAndroid.PERMISSIONS.SEND_SMS;
        let granted = await PermissionsAndroid.check(permission);
        if (!granted) {
          const result = await PermissionsAndroid.request(permission, {
            title: 'Send SMS for SOS',
            message:
              'When your watch sends an SOS, JoyoFit sends the text message it asks for, from this phone and your SIM. It never sends anything else.',
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          });
          granted = result === PermissionsAndroid.RESULTS.GRANTED;
          setBlocked(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
        }
        if (!granted) {
          setError('Without the SMS permission JoyoFit cannot send the SOS text. The relay stays off.');
          return;
        }
      }
      await HuaweiWear.setSosRelayEnabled(enabled);
    });

  const fallState = FALL_LABELS[String(safety.fallSwitch) as keyof typeof FALL_LABELS];

  return (
    <>
      <Section title="Fall detection" icon="body">
        <SwitchRow
          icon="walk"
          label="Detect falls on the watch"
          hint={
            safety.fallSupported
              ? safety.smsSupported
                ? 'The watch asks you if you are all right after a hard fall and can start an SOS.'
                : 'The watch asks you if you are all right after a hard fall. This version of JoyoFit cannot send the SOS text.'
              : `Not available: ${safety.fallNote}.`
          }
          value={safety.fallSwitch === 1}
          disabled={!safety.fallSupported || busy}
          onValueChange={(enabled) => run(async () => void (await HuaweiWear.setFallDetection(enabled)))}
        />
        <KeyValue icon="watch" label="Watch reports" value={fallState} />
        <KeyValue
          icon="time"
          label="Last changed"
          value={safety.fallUpdatedMs > 0 ? formatDateTime(safety.fallUpdatedMs / 1000) : null}
        />
        <Button
          label="Ask the watch"
          variant="secondary"
          icon="refresh"
          disabled={!safety.fallSupported || busy}
          onPress={() => run(async () => void (await HuaweiWear.queryFallDetection()))}
        />
      </Section>

      {safety.smsSupported ? (
        <Section title="SOS text messages" icon="alert-circle" tint="heart">
          <AppText variant="caption" muted>
            When you start an SOS on the watch, the watch hands this phone a number and a message. With the switch on, JoyoFit sends
            that text from your SIM and tells the watch whether it went out. The watch (or its emergency contacts in the Huawei
            settings on it) decides who is texted; JoyoFit never picks a recipient and never sends anything the watch did not ask for.
          </AppText>
          <SwitchRow
            icon="chatbubble-ellipses"
            label="Send SOS texts for the watch"
            hint="Off by default. Needs permission to send SMS and a ready SIM; costs whatever your plan charges per text."
            value={safety.sosRelayEnabled}
            disabled={busy}
            onValueChange={toggleSos}
          />
          <KeyValue icon="checkmark-circle" label="Permission to send SMS" value={safety.smsPermission ? 'Granted' : 'Not granted'} />
          <KeyValue icon="card" label="SIM card" value={!safety.telephony ? 'No telephony' : safety.simReady ? 'Ready' : 'Not ready'} />
          <KeyValue
            icon="watch"
            label="Watch lists SOS texts"
            value={safety.sosListedByWatch ? 'Yes' : 'Not in its capability list'}
          />
          <Divider />
          <Button
            label="Check without sending"
            variant="secondary"
            icon="shield-checkmark"
            disabled={busy}
            onPress={() => {
              setError(null);
              const result = HuaweiWear.testSosRelay();
              setTest(
                result.ready
                  ? 'Ready: an SOS from the watch would be sent as a text. Nothing was sent now.'
                  : `An SOS from the watch would not be sent: ${result.blockers.join('; ')}. The watch would be told it failed. Nothing was sent now.`,
              );
              refresh();
            }}
          />
          {test ? <Notice icon={safety.sosReady ? 'checkmark-circle' : 'information-circle'}>{test}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {blocked ? (
            <Button label="Open app settings" variant="secondary" icon="settings-outline" onPress={() => void Linking.openSettings()} />
          ) : null}
        </Section>
      ) : (
        <Section title="SOS text messages" icon="alert-circle" tint="heart">
          <AppText variant="caption" muted>
            Not available in the Google Play version of JoyoFit: Google Play restricts apps that send text messages, so this version
            does not include the feature. An SOS started on the watch is not sent as an SMS from this phone: JoyoFit tells the watch
            that nothing was sent. Do not rely on the watch to text your contacts.
          </AppText>
        </Section>
      )}

      <Section title="Morning sleep report" icon="moon" tint="sleep">
        <SwitchRow
          icon="notifications"
          label="Show last night's sleep on the watch"
          hint={
            safety.sleepReportSupported
              ? 'Once each morning, after the first sync that holds last night, the watch shows how long you slept and the stages.'
              : 'Not available: the watch does not report the event channel it needs.'
          }
          value={safety.sleepReportEnabled}
          disabled={!safety.sleepReportSupported || busy}
          onValueChange={(enabled) => run(() => HuaweiWear.setSleepReportEnabled(enabled))}
        />
        <Button
          label="Send last night's report now"
          variant="secondary"
          icon="send"
          disabled={!safety.sleepReportSupported || busy}
          onPress={() =>
            run(async () => {
              const outcome = await HuaweiWear.sendSleepReportNow();
              setSleepNote(outcome === 'sent' ? 'Sent. Check the watch.' : `Not sent: ${outcome}.`);
            })
          }
        />
        {sleepNote ? <Notice>{sleepNote}</Notice> : null}
      </Section>
    </>
  );
}
