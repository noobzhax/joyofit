import { Screen } from '@/components/Screen';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PhoneSection } from '@/features/settings/PhoneSection';

export default function NotificationsSettingsScreen() {
  return (
    <Screen>
      <NotificationsSection />
      <PhoneSection />
    </Screen>
  );
}
