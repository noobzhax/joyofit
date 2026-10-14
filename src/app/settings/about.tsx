import Constants from 'expo-constants';

import { KeyValue } from '@/components/KeyValue';
import { Section, Screen } from '@/components/Screen';
import { Notice } from '@/components/States';

export default function AboutScreen() {
  return (
    <Screen>
      <Section title="JoyoFit" icon="information-circle">
        <KeyValue icon="phone-portrait" label="App" value="JoyoFit" />
        <KeyValue icon="pricetag" label="Version" value={Constants.expoConfig?.version ?? null} />
        <KeyValue icon="document-text" label="License" value="AGPL-3.0-or-later" />
        <Notice icon="lock-closed">
          Data stays on this phone in joyofit.db until you sign in to the cloud.
        </Notice>
      </Section>
    </Screen>
  );
}
