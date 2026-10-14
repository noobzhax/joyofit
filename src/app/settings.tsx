import { Screen } from '@/components/Screen';
import { BackgroundSection } from '@/features/settings/BackgroundSection';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PhoneSection } from '@/features/settings/PhoneSection';
import { ProfileSection } from '@/features/settings/ProfileSection';
import { WeatherSection } from '@/features/settings/WeatherSection';

export default function SettingsScreen() {
  return (
    <Screen>
      <BackgroundSection />
      <NotificationsSection />
      <PhoneSection />
      <WeatherSection />
      <HealthConnectSection />
      <ProfileSection />
    </Screen>
  );
}
