import { Screen } from '@/components/Screen';
import { BackgroundSection } from '@/features/settings/BackgroundSection';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { ProfileSection } from '@/features/settings/ProfileSection';

export default function SettingsScreen() {
  return (
    <Screen>
      <BackgroundSection />
      <NotificationsSection />
      <ProfileSection />
    </Screen>
  );
}
