import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, PermissionsAndroid, type Permission } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

const { PERMISSIONS, RESULTS } = PermissionsAndroid;

/**
 * Asks for [required] and then for the optional ones in the same dialog sequence. Resolves with
 * whether every required permission is granted and whether Android will no longer show the dialog.
 */
async function ask(required: Permission[], optional: Permission[]) {
  const results = await PermissionsAndroid.requestMultiple([...required, ...optional]);
  const granted = required.every((p) => results[p] === RESULTS.GRANTED);
  const blocked = required.some((p) => results[p] === RESULTS.NEVER_ASK_AGAIN);
  return { granted, blocked };
}

/** Find my phone, incoming calls on the watch, call control from the watch, and the alarms screen link. */
export function PhoneSection() {
  const router = useRouter();
  const [features, setFeatures] = useState(() => HuaweiWear.getPhoneFeatures());
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const refresh = useCallback(() => setFeatures(HuaweiWear.getPhoneFeatures()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      refresh();
    }
  };

  const toggleCalls = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const result = await ask(
          [PERMISSIONS.READ_PHONE_STATE],
          [PERMISSIONS.READ_CALL_LOG, PERMISSIONS.READ_CONTACTS],
        );
        if (!result.granted) {
          setBlocked(result.blocked);
          setError('Phone state permission is required to see incoming calls.');
          return;
        }
      }
      await HuaweiWear.setCallsEnabled(enabled);
    });

  const toggleCallControl = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const result = await ask([PERMISSIONS.ANSWER_PHONE_CALLS], []);
        if (!result.granted) {
          setBlocked(result.blocked);
          setError('Permission to answer phone calls is required.');
          return;
        }
      }
      await HuaweiWear.setCallControlEnabled(enabled);
    });

  return (
    <Section title="Find, calls and alarms">
      <SwitchRow
        label="Find my phone from the watch"
        value={features.findPhoneEnabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setFindPhoneEnabled(enabled))}
      />
      <AppText variant="caption" muted>
        The find-phone button on the watch rings this phone loudly on the alarm volume, even while the
        app is closed (background mode keeps the link up). Stop it on the watch or from the
        notification.
      </AppText>

      <SwitchRow
        label="Show incoming calls on the watch"
        value={features.callsEnabled}
        onValueChange={toggleCalls}
      />
      <KeyValue label="Phone state" value={features.readPhoneState ? 'Granted' : 'Not granted'} />
      <KeyValue label="Caller number (call log)" value={features.readCallLog ? 'Granted' : 'Not granted'} />
      <KeyValue label="Contact names" value={features.readContacts ? 'Granted' : 'Not granted'} />
      <AppText variant="caption" muted>
        Without call log access Android hides the caller number; without contacts access the
        number is shown instead of the name.
      </AppText>

      <SwitchRow
        label="Answer and reject calls from the watch"
        value={features.callControlEnabled}
        onValueChange={toggleCallControl}
      />
      <KeyValue label="Answer phone calls" value={features.answerPhoneCalls ? 'Granted' : 'Not granted'} />

      {error ? (
        <AppText variant="caption" danger selectable>
          {error}
        </AppText>
      ) : null}
      {blocked ? <Button label="Open app settings" onPress={() => void Linking.openSettings()} /> : null}

      <Button label="Watch alarms" onPress={() => router.push('/alarms')} />
    </Section>
  );
}
