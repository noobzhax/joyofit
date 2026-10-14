import { Screen } from '@/components/Screen';
import { BackgroundSection } from '@/features/settings/BackgroundSection';
import { HeartRateSection } from '@/features/settings/HeartRateSection';

export default function SyncSettingsScreen() {
  return (
    <Screen>
      <BackgroundSection />
      <HeartRateSection />
    </Screen>
  );
}
