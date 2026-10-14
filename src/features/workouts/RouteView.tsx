import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { downsample, projectRoute, type RoutePoint } from '@/features/workouts/summary';
import { usePalette } from '@/theme';

const WIDTH = 320;
const HEIGHT = 240;
const PADDING = 16;
const MAX_POINTS = 800;

/** The GPS track as an SVG polyline, north up, scaled to fit. Start is a filled dot, end a ring. */
export function RouteView({ route }: { route: readonly RoutePoint[] }) {
  const palette = usePalette();
  const projected = useMemo(
    () => projectRoute(downsample(route, MAX_POINTS), WIDTH, HEIGHT, PADDING),
    [route],
  );

  if (!projected) {
    return (
      <AppText variant="caption" muted>
        No GPS track stored for this workout.
      </AppText>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`Route with ${route.length} GPS points`}
      style={[styles.box, { borderColor: palette.border }]}>
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Polyline
          points={projected.polyline}
          fill="none"
          stroke={palette.accent}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={projected.start.x} cy={projected.start.y} r={5} fill={palette.accent} />
        <Circle
          cx={projected.end.x}
          cy={projected.end.y}
          r={6}
          fill={palette.surface}
          stroke={palette.accent}
          strokeWidth={3}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden' },
});
