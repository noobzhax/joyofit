import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen } from '@/components/Screen';
import { useColors } from '@/theme';

export default function AdvancedScreen() {
  const colors = useColors();
  const router = useRouter();
  return (
    <Screen>
      <View>
        <NavRow
          icon="terminal"
          title="Log"
          subtitle="Watch traffic and events"
          onPress={() => router.push('/settings/log')}
          style={groupedRowStyle(colors, 0, 2)}
        />
        <NavRow
          icon="information-circle"
          title="About"
          onPress={() => router.push('/settings/about')}
          style={groupedRowStyle(colors, 1, 2)}
        />
      </View>
    </Screen>
  );
}
