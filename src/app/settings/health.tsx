import { Screen } from '@/components/Screen';
import { CloudSection } from '@/features/settings/CloudSection';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';

export default function HealthSettingsScreen() {
  return (
    <Screen>
      <HealthConnectSection />
      <CloudSection />
    </Screen>
  );
}
