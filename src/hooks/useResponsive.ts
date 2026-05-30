import { useWindowDimensions } from 'react-native';

// The smaller window dimension cleanly separates form factors: every iPhone
// (even the Pro Max) stays under ~440pt on its short edge, while every iPad
// (mini included) is 744pt or wider. Comparing the *smaller* edge means the
// classification doesn't flip when the device rotates.
const LARGE_SCREEN_MIN_EDGE = 600;

export interface Responsive {
  /** True on iPad-class devices (and large windows) — switch to the iPad layouts. */
  isLarge: boolean;
  /** True when wider than tall. iPad split-views use this to collapse to single-pane in portrait. */
  isLandscape: boolean;
  width: number;
  height: number;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    isLarge: Math.min(width, height) >= LARGE_SCREEN_MIN_EDGE,
    isLandscape: width > height,
    width,
    height,
  };
}
