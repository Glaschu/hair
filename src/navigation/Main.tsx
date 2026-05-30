import React from 'react';
import { useResponsive } from '../hooks/useResponsive';
import { TabNavigator } from './TabNavigator';
import { IPadShell } from '../ipad/IPadShell';

/**
 * Top-level adaptive surface: the persistent-sidebar iPad layout on large
 * screens, the bottom-tab layout on phones. Rendered inside the root stack so
 * either layout can still push the shared detail/modal screens.
 */
export function Main() {
  const { isLarge } = useResponsive();
  return isLarge ? <IPadShell /> : <TabNavigator />;
}
