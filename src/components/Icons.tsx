import React from 'react';
import Svg, { Path, Circle, Rect, G } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function Icon({ size = 22, color = '#000', strokeWidth = 1.6, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </G>
    </Svg>
  );
}

export const Icons = {
  home: (p: IconProps) => (
    <Icon {...p}><Path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/></Icon>
  ),
  layout: (p: IconProps) => (
    <Icon {...p}><Rect x={3} y={3} width={18} height={18} rx={2} ry={2}/><Path d="M3 9h18"/><Path d="M9 21V9"/></Icon>
  ),
  cloud: (p: IconProps) => (
    <Icon {...p}><Path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></Icon>
  ),
  users: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <Circle cx={9} cy={7} r={4}/>
      <Path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </Icon>
  ),
  calendar: (p: IconProps) => (
    <Icon {...p}>
      <Rect x={3} y={5} width={18} height={16} rx={2}/>
      <Path d="M3 9h18M8 3v4M16 3v4"/>
    </Icon>
  ),
  inventory: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M3 7l9-4 9 4-9 4-9-4z"/>
      <Path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>
    </Icon>
  ),
  search: (p: IconProps) => (
    <Icon {...p}>
      <Circle cx={11} cy={11} r={7}/>
      <Path d="M21 21l-4.3-4.3"/>
    </Icon>
  ),
  plus: (p: IconProps) => (
    <Icon {...p}><Path d="M12 5v14M5 12h14"/></Icon>
  ),
  chevronRight: (p: IconProps) => (
    <Icon {...p}><Path d="M9 6l6 6-6 6"/></Icon>
  ),
  chevronLeft: (p: IconProps) => (
    <Icon {...p}><Path d="M15 6l-6 6 6 6"/></Icon>
  ),
  chevronDown: (p: IconProps) => (
    <Icon {...p}><Path d="M6 9l6 6 6-6"/></Icon>
  ),
  close: (p: IconProps) => (
    <Icon {...p}><Path d="M18 6L6 18M6 6l12 12"/></Icon>
  ),
  phone: (p: IconProps) => (
    <Icon {...p}><Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></Icon>
  ),
  message: (p: IconProps) => (
    <Icon {...p}><Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></Icon>
  ),
  bell: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M13.73 21a2 2 0 0 1-3.46 0"/>
    </Icon>
  ),
  alert: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <Path d="M12 9v4M12 17h.01"/>
    </Icon>
  ),
  check: (p: IconProps) => (
    <Icon {...p}><Path d="M5 12l5 5L20 7"/></Icon>
  ),
  clock: (p: IconProps) => (
    <Icon {...p}>
      <Circle cx={12} cy={12} r={9}/>
      <Path d="M12 7v5l3 2"/>
    </Icon>
  ),
  flask: (p: IconProps) => (
    <Icon {...p}><Path d="M9 2v6L4 18a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L15 8V2M8 2h8M7 13h10"/></Icon>
  ),
  scissors: (p: IconProps) => (
    <Icon {...p}>
      <Circle cx={6} cy={6} r={3}/>
      <Circle cx={6} cy={18} r={3}/>
      <Path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>
    </Icon>
  ),
  trend: (p: IconProps) => (
    <Icon {...p}><Path d="M3 17l6-6 4 4 8-8M17 7h4v4"/></Icon>
  ),
  edit: (p: IconProps) => (
    <Icon {...p}><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Icon>
  ),
  trash: (p: IconProps) => (
    <Icon {...p}><Path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></Icon>
  ),
  settings: (p: IconProps) => (
    <Icon {...p}>
      <Circle cx={12} cy={12} r={3}/>
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </Icon>
  ),
  arrowRight: (p: IconProps) => (
    <Icon {...p}><Path d="M5 12h14M13 6l6 6-6 6"/></Icon>
  ),
  camera: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <Circle cx={12} cy={13} r={4}/>
    </Icon>
  ),
  star: (p: IconProps) => (
    <Icon {...p}><Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></Icon>
  ),
  package: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <Path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
    </Icon>
  ),
  barcode: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
      <Path d="M7 8v8M11 8v8M15 8v8M19 8v8"/>
    </Icon>
  ),
  clipboardCheck: (p: IconProps) => (
    <Icon {...p}>
      <Path d="M9 11l3 3 8-8"/>
      <Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </Icon>
  ),
  instagram: (p: IconProps) => (
    <Icon {...p}>
      <Rect x={2} y={2} width={20} height={20} rx={5} ry={5}/>
      <Path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <Path d="M17.5 6.5h.01"/>
    </Icon>
  ),
  moreHorizontal: (p: IconProps) => (
    <Icon {...p}>
      <Circle cx={5} cy={12} r={1}/>
      <Circle cx={12} cy={12} r={1}/>
      <Circle cx={19} cy={12} r={1}/>
    </Icon>
  ),
  lock: (p: IconProps) => (
    <Icon {...p}>
      <Rect x={5} y={11} width={14} height={9} rx={2}/>
      <Path d="M8 11V8a4 4 0 0 1 8 0v3"/>
    </Icon>
  ),
};
