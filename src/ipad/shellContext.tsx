import React, { createContext, useContext, useMemo, useState } from 'react';

export type Section = 'today' | 'clients' | 'calendar' | 'inventory' | 'reports' | 'settings';

interface IPadShellState {
  section: Section;
  setSection: (s: Section) => void;

  // Split-view selections (master/detail). Persisted while the section stays mounted.
  selectedClientId: string | null;
  selectedProductId: string | null;

  /** Jump to the Clients section and focus a client in the detail pane. */
  goToClient: (id: string) => void;
  /** Jump to the Inventory section and focus a product in the detail pane. */
  goToProduct: (id: string) => void;
  setSelectedClientId: (id: string | null) => void;
  setSelectedProductId: (id: string | null) => void;
}

const IPadShellContext = createContext<IPadShellState | null>(null);

export function IPadShellProvider({ children }: { children: React.ReactNode }) {
  const [section, setSection] = useState<Section>('today');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const value = useMemo<IPadShellState>(() => ({
    section,
    setSection,
    selectedClientId,
    selectedProductId,
    setSelectedClientId,
    setSelectedProductId,
    goToClient: (id) => { setSelectedClientId(id); setSection('clients'); },
    goToProduct: (id) => { setSelectedProductId(id); setSection('inventory'); },
  }), [section, selectedClientId, selectedProductId]);

  return <IPadShellContext.Provider value={value}>{children}</IPadShellContext.Provider>;
}

export function useShell(): IPadShellState {
  const ctx = useContext(IPadShellContext);
  if (!ctx) throw new Error('useShell must be used within IPadShellProvider');
  return ctx;
}
