import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useReducedMotion } from '@/hooks/useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface RingProps {
  size: number;
  stroke: number;
  value: number;
  max: number;
  color: string;
  track: string;
  accessibilityLabel: string;
  /** Centered inside the ring. */
  children?: ReactNode;
}

/** Progress ring. Fills once on mount and when the value changes (600 ms); static under reduced motion. */
export function Ring({ size, stroke, value, max, color, track, accessibilityLabel, children }: RingProps) {
  const reduced = useReducedMotion();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(ratio);
      return;
    }
    Animated.timing(progress, {
      toValue: ratio,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, ratio, reduced]);

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const half = size / 2;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(Math.min(value, max)) }}
      style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={half} cy={half} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={half}
          cy={half}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
          transform={`rotate(-90 ${half} ${half})`}
        />
      </Svg>
      {children ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
