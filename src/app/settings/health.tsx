import { Screen } from '@/components/Screen';
import { CloudSection } from '@/features/settings/CloudSection';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';
import { HealthyLivingSection } from '@/features/settings/HealthyLivingSection';

export default function HealthSettingsScreen() {
  return (
    <Screen>
      <HealthConnectSection />
      <HealthyLivingSection />
      <CloudSection />
    </Screen>
  );
}
