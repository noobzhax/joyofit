import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Section, Screen } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { useColors } from '@/theme';
import { HuaweiWear } from '@/wear';

export default function AdvancedScreen() {
  const colors = useColors();
  const router = useRouter();
  const [courses, setCourses] = useState(() => HuaweiWear.getCourses());
  const [coursesBusy, setCoursesBusy] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);

  useNativeRefresh(useCallback(() => setCourses(HuaweiWear.getCourses()), []));

  const toggleCourses = async (enabled: boolean) => {
    setCoursesBusy(true);
    setCoursesError(null);
    try {
      await HuaweiWear.setCoursesEnabled(enabled);
    } catch (e) {
      setCoursesError(errorMessage(e));
    } finally {
      setCourses(HuaweiWear.getCourses());
      setCoursesBusy(false);
    }
  };

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
      <Section title="Experimental" icon="flask" tint="workouts">
        <SwitchRow
          label="Running courses (experimental)"
          hint="Unverified: the course format comes from static analysis of Huawei Health. The watch may refuse it."
          value={courses.enabled}
          disabled={coursesBusy}
          onValueChange={(enabled) => void toggleCourses(enabled)}
        />
        {coursesError ? <Notice tone="danger">{coursesError}</Notice> : null}
      </Section>
      {courses.enabled ? (
        <NavRow
          icon="walk"
          tint="workouts"
          title="Running courses"
          subtitle="Build a course and send it to the watch"
          onPress={() => router.push('/settings/courses')}
          style={groupedRowStyle(colors, 0, 1)}
        />
      ) : null}
    </Screen>
  );
}
