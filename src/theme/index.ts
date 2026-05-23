import { TextStyle } from 'react-native';

export type Theme = typeof lightTheme;

export const palette = {
  cream: '#FAF6F0',
  cream2: '#F3ECE3',
  card: '#FFFFFF',
  ink: '#2A201A',
  ink2: '#6B5B4E',
  ink3: '#A8978A',
  line: 'rgba(42,32,26,0.1)',
  sage: '#6B7B5C',
  warn: '#C07E2A',
  danger: '#B84040',
  cardDark: '#2A2420',
  bgDark: '#1C1714',
  bg2Dark: '#231E1A',
};

export const lightTheme = {
  dark: false,
  bg: palette.cream,
  bg2: palette.cream2,
  card: palette.card,
  ink: palette.ink,
  ink2: palette.ink2,
  ink3: palette.ink3,
  line: palette.line,
  sage: palette.sage,
  warn: palette.warn,
  danger: palette.danger,
  accent: '#C26E4A',
  heroBg: '#2A201A',
  tabBar: palette.cream,
  shadow: 'rgba(42,32,26,0.12)',
};

export const darkTheme: Theme = {
  dark: true,
  bg: palette.bgDark,
  bg2: palette.bg2Dark,
  card: palette.cardDark,
  ink: '#F5EDE5',
  ink2: '#B8A89A',
  ink3: '#7A6A5E',
  line: 'rgba(255,240,230,0.1)',
  sage: '#8BA07A',
  warn: '#D49A4A',
  danger: '#D06060',
  accent: '#C26E4A',
  heroBg: '#3D3028',
  tabBar: palette.bgDark,
  shadow: 'rgba(0,0,0,0.4)',
};

export const accentOptions = [
  '#C26E4A',
  '#8E6748',
  '#7A8B5C',
  '#6B7B8E',
  '#A85A6E',
  '#2A201A',
];

export const typography = {
  serif: (size: number, weight: TextStyle['fontWeight'] = '500'): TextStyle => ({
    fontFamily: 'CormorantGaramond_500Medium_Italic',
    fontSize: size,
    fontWeight: weight,
    letterSpacing: -0.015 * size,
  }),
  sans: (size: number, weight: TextStyle['fontWeight'] = '400'): TextStyle => ({
    fontFamily: 'DMSans_400Regular',
    fontSize: size,
    fontWeight: weight,
  }),
  sansMedium: (size: number): TextStyle => ({
    fontFamily: 'DMSans_500Medium',
    fontSize: size,
  }),
  mono: (size: number): TextStyle => ({
    fontFamily: 'DMMono_400Regular',
    fontSize: size,
    letterSpacing: 0.05 * size,
  }),
};
