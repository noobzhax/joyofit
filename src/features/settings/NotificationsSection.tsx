import { useCallback, useState } from 'react';

import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

export function NotificationsSection() {
  const [access, setAccess] = useState(() => HuaweiWear.getNotificationAccess());
  const [error, setError] = useState<string | null>(null);

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
    <Section title="Notifications" icon="notifications">
      <KeyValue
        icon="key"
        label="Notification access"
        value={access.granted ? 'Granted' : 'Not granted'}
      />
      <Button
        label="Open notification access"
        variant="secondary"
        icon="open-outline"
        onPress={() => run(() => HuaweiWear.openNotificationAccess())}
      />
      <Notice>
        On Android 13 and newer, an app installed outside the Play Store must first be allowed to
        use restricted settings: App info, then the menu (three dots), then Allow restricted
        settings.
      </Notice>
      <SwitchRow
        icon="notifications"
        label="Forward notifications to the watch"
        hint={
          access.granted
            ? 'Sends the app name, title and text of each notification.'
            : 'Grant notification access first.'
        }
        value={access.enabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setNotificationsEnabled(enabled))}
        disabled={!access.granted}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Section>
  );
}
