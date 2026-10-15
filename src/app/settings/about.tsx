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
          Watch data stays on this phone in joyofit.db until you sign in to the cloud. Weather, if switched on, sends
          rounded coordinates to Open-Meteo. Privacy policy: fit.joyorogo.com/privasi
        </Notice>
      </Section>
    </Screen>
  );
}
