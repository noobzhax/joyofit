import { Screen } from '@/components/Screen';
import { BackgroundSection } from '@/features/settings/BackgroundSection';
import { CloudSection } from '@/features/settings/CloudSection';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PhoneSection } from '@/features/settings/PhoneSection';
import { ProfileSection } from '@/features/settings/ProfileSection';
import { WeatherSection } from '@/features/settings/WeatherSection';
import { WatchfacesSection } from '@/features/settings/WatchfacesSection';

export default function SettingsScreen() {
  return (
    <Screen>
      <BackgroundSection />
      <NotificationsSection />
      <PhoneSection />
      <WatchfacesSection />
      <WeatherSection />
      <HealthConnectSection />
      <CloudSection />
      <ProfileSection />
    </Screen>
  );
}
