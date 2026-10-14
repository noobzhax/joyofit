import { useCallback, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { NotificationAppList } from '@/features/settings/NotificationAppList';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

export function NotificationsSection() {
  const [access, setAccess] = useState(() => HuaweiWear.getNotificationAccess());
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const refresh = useCallback(() => setAccess(HuaweiWear.getNotificationAccess()), []);
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

  return (
    <Section title="Notifications">
      <AppText variant="caption">
        JoyoFit forwards the app name, title and text of posted notifications to the watch.
      </AppText>
      <KeyValue label="Notification access" value={access.granted ? 'Granted' : 'Not granted'} />
      <Button
        label="Open notification access"
        onPress={() => run(() => HuaweiWear.openNotificationAccess())}
      />
      <AppText variant="caption" muted>
        On Android 13 and newer, an app installed outside the Play Store must first be allowed to
        use restricted settings: App info, then the menu (three dots), then Allow restricted
        settings.
      </AppText>
      <SwitchRow
        label="Forward notifications to the watch"
        value={access.enabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setNotificationsEnabled(enabled))}
        disabled={!access.granted}
      />
      {error ? (
        <AppText variant="caption" danger selectable>
          {error}
        </AppText>
      ) : null}
      <Button
        label={choosing ? 'Hide apps' : 'Choose apps'}
        onPress={() => setChoosing((open) => !open)}
      />
      {choosing ? <NotificationAppList /> : null}
    </Section>
  );
}
