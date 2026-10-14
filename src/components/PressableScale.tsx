import { useState } from 'react';
import { Animated, Easing, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** Scale while pressed; 0.97 keeps it tactile without a visible jump. */
  scaleTo?: number;
};

/**
 * Pressable with press feedback: scales to 0.97 in 100 ms, back in 160 ms, and dims slightly. Dimming
 * stays under reduced motion; the scale does not. Disabled controls rest at 45% opacity.
 */
export function PressableScale({
  style,
  children,
  scaleTo = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const [progress] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();
  const resting = disabled ? 0.45 : 1;

  const animate = (toValue: number, duration: number) =>
    Animated.timing(progress, {
      toValue,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        animate(1, 100);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(0, 160);
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [resting, resting * 0.85] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1 : scaleTo] }) },
          ],
        },
      ]}>
      {children}
    </AnimatedPressable>
  );
}
