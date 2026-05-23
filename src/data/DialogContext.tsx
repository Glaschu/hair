import React, { createContext, useContext } from 'react';
import { useLocalDialog } from '../components/Dialog';
import type { DialogApi } from '../components/Dialog';

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const { confirm, alert, actionSheet, dialog } = useLocalDialog();

  return (
    <DialogContext.Provider value={{ confirm, alert, actionSheet }}>
      {children}
      {dialog}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}
