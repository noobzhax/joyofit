import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';

/** Link to the watch faces screen. */
export function WatchfacesSection() {
  const router = useRouter();
  return (
    <Section title="Watch faces">
      <AppText variant="caption" muted>
        List, switch, delete and install watch faces (.hwt files from Huawei Theme Studio Pro).
      </AppText>
      <Button label="Watch faces" onPress={() => router.push('/watchfaces')} />
    </Section>
  );
}
