import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, AppState as RNAppState } from 'react-native';
import { Client, Product, Appointment, Service, Schedule, ExportPayload } from './types';
import { lightTheme, darkTheme, Theme, accentOptions } from '../theme';
import { db } from '../db';
import * as schema from '../db/schema';
import { seedIfEmpty } from '../db/seed';
import { CLIENTS, PRODUCTS, WEEK_APPOINTMENTS, SERVICES, DEFAULT_SCHEDULE } from './mockData';
import {
  rowToClient, clientToRow,
  rowToProduct, productToRow,
  rowToAppointment, appointmentToRow,
  rowToService, serviceToRow,
  rowsToSchedule,
} from '../db/helpers';
import { syncAppointmentReminders, setupNotificationChannel } from './notifications';
import { writeAutoBackup } from './backup';

interface AppState {
  theme: Theme;
  accent: string;
  dark: boolean;
  setAccent: (c: string) => void;
  setDark: (v: boolean) => void;

  studioName: string;
  setStudioName: (n: string) => void;

  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;

  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;

  appointments: Appointment[];
  setAppointments: React.Dispatch<React.SetStateAction<Appointment[]>>;

  services: Service[];
  setServices: React.Dispatch<React.SetStateAction<Service[]>>;

  schedule: Schedule;
  setSchedule: React.Dispatch<React.SetStateAction<Schedule>>;

  density: 'compact' | 'regular' | 'comfy';
  setDensity: (d: 'compact' | 'regular' | 'comfy') => void;

  bookingWindowDays: number;
  setBookingWindowDays: (n: number) => void;

  lastExportAt: string | null;
  markExported: () => void;

  remindersEnabled: boolean;
  setRemindersEnabled: (v: boolean) => void;

  reminderLeadMinutes: number;
  setReminderLeadMinutes: (n: number) => void;

  resetToDemo: () => void;
  loadFromExport: (data: ExportPayload) => void;
}

export type { ExportPayload } from './types';

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const loadedRef = useRef(false);

  const [accent, setAccentState] = useState(accentOptions[0]);
  const [dark, setDarkState] = useState(false);
  const [studioName, setStudioNameState] = useState('Iris');
  const [clients, setClientsState] = useState<Client[]>([]);
  const [products, setProductsState] = useState<Product[]>([]);
  const [appointments, setAppointmentsState] = useState<Appointment[]>([]);
  const [services, setServicesState] = useState<Service[]>([]);
  const [schedule, setScheduleState] = useState<Schedule>({});
  const [density, setDensityState] = useState<'compact' | 'regular' | 'comfy'>('regular');
  const [bookingWindowDays, setBookingWindowDaysState] = useState(90);
  const [remindersEnabled, setRemindersEnabledState] = useState(false);
  const [reminderLeadMinutes, setReminderLeadMinutesState] = useState(60);
  const [lastExportAt, setLastExportAtState] = useState<string | null>(null);

  useEffect(() => {
    try {
      seedIfEmpty();

      const dbClients = db.select().from(schema.clients).all();
      const dbPhotos  = db.select().from(schema.clientPhotos).all();
      setClientsState(dbClients.map(r => rowToClient(r, dbPhotos.filter(p => p.clientId === r.id))));

      const dbProducts = db.select().from(schema.products).all();
      setProductsState(dbProducts.map(rowToProduct));

      const dbAppts     = db.select().from(schema.appointments).all();
      const dbApptProds = db.select().from(schema.appointmentProducts).all();
      setAppointmentsState(dbAppts.map(r => rowToAppointment(r, dbApptProds)));

      const dbServices = db.select().from(schema.services).all();
      const dbSvcProds = db.select().from(schema.serviceProducts).all();
      setServicesState(dbServices.map(r => rowToService(r, dbSvcProds)));

      const dbSchedule = db.select().from(schema.schedule).all();
      if (dbSchedule.length > 0) setScheduleState(rowsToSchedule(dbSchedule));

      const dbSettings = db.select().from(schema.settings).all();
      const get = (key: string) => dbSettings.find(s => s.key === key)?.value;
      if (get('studioName'))        setStudioNameState(get('studioName')!);
      if (get('accent'))            setAccentState(get('accent')!);
      if (get('dark'))              setDarkState(get('dark') === 'true');
      if (get('density'))           setDensityState(get('density') as any);
      if (get('bookingWindowDays')) setBookingWindowDaysState(Number(get('bookingWindowDays')));
      if (get('remindersEnabled'))    setRemindersEnabledState(get('remindersEnabled') === 'true');
      if (get('reminderLeadMinutes')) setReminderLeadMinutesState(Number(get('reminderLeadMinutes')));
      if (get('lastExportAt'))        setLastExportAtState(get('lastExportAt')!);

      loadedRef.current = true;
      setLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  const setSetting = (key: string, value: string) => {
    if (!loadedRef.current) return;
    db.insert(schema.settings).values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  };

  const setAccent = (c: string) => { setAccentState(c); setSetting('accent', c); };
  const setDark   = (v: boolean) => { setDarkState(v);   setSetting('dark', String(v)); };
  const setStudioName = (n: string) => { setStudioNameState(n); setSetting('studioName', n); };
  const setDensity = (d: 'compact' | 'regular' | 'comfy') => { setDensityState(d); setSetting('density', d); };
  const setBookingWindowDays = (n: number) => { setBookingWindowDaysState(n); setSetting('bookingWindowDays', String(n)); };
  const setRemindersEnabled = (v: boolean) => { setRemindersEnabledState(v); setSetting('remindersEnabled', String(v)); };
  const setReminderLeadMinutes = (n: number) => { setReminderLeadMinutesState(n); setSetting('reminderLeadMinutes', String(n)); };

  useEffect(() => { setupNotificationChannel(); }, []);

  // Keep scheduled appointment reminders in sync with the data and reminder settings.
  useEffect(() => {
    if (!loaded) return;
    syncAppointmentReminders(appointments, clients, reminderLeadMinutes, remindersEnabled).catch(() => {});
  }, [loaded, appointments, clients, reminderLeadMinutes, remindersEnabled]);

  const markExported = () => {
    const now = new Date().toISOString();
    setLastExportAtState(now);
    setSetting('lastExportAt', now);
  };

  // Latest data snapshot, kept current for the on-background auto-backup.
  const snapshotRef = useRef<ExportPayload>({
    version: 1, exported: '', clients: [], products: [], appointments: [], services: [], schedule: {},
  });
  snapshotRef.current = {
    version: 1,
    exported: new Date().toISOString(),
    clients, products, appointments, services, schedule,
  };

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'background' && loadedRef.current) {
        writeAutoBackup(snapshotRef.current);
      }
    });
    return () => sub.remove();
  }, []);

  const setClients: React.Dispatch<React.SetStateAction<Client[]>> = (action) => {
    setClientsState(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (loadedRef.current) {
        db.transaction((tx) => {
          tx.delete(schema.clientPhotos).run();
          tx.delete(schema.clients).run();
          next.forEach(c => {
            tx.insert(schema.clients).values(clientToRow(c))
              .onConflictDoUpdate({ target: schema.clients.id, set: clientToRow(c) }).run();
            (c.photos ?? []).forEach(p =>
              tx.insert(schema.clientPhotos).values({ ...p, clientId: c.id })
                .onConflictDoUpdate({ target: schema.clientPhotos.id, set: { ...p, clientId: c.id } }).run()
            );
          });
        });
      }
      return next;
    });
  };

  const setProducts: React.Dispatch<React.SetStateAction<Product[]>> = (action) => {
    setProductsState(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (loadedRef.current) {
        db.transaction((tx) => {
          tx.delete(schema.products).run();
          next.forEach(p =>
            tx.insert(schema.products).values(productToRow(p))
              .onConflictDoUpdate({ target: schema.products.id, set: productToRow(p) }).run()
          );
        });
      }
      return next;
    });
  };

  const setAppointments: React.Dispatch<React.SetStateAction<Appointment[]>> = (action) => {
    setAppointmentsState(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (loadedRef.current) {
        db.transaction((tx) => {
          tx.delete(schema.appointmentProducts).run();
          tx.delete(schema.appointments).run();
          next.forEach(a => {
            tx.insert(schema.appointments).values(appointmentToRow(a))
              .onConflictDoUpdate({ target: schema.appointments.id, set: appointmentToRow(a) }).run();
            a.products.forEach(ap =>
              tx.insert(schema.appointmentProducts).values({ appointmentId: a.id, ...ap }).run()
            );
          });
        });
      }
      return next;
    });
  };

  const setServices: React.Dispatch<React.SetStateAction<Service[]>> = (action) => {
    setServicesState(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (loadedRef.current) {
        db.transaction((tx) => {
          tx.delete(schema.serviceProducts).run();
          tx.delete(schema.services).run();
          next.forEach(s => {
            tx.insert(schema.services).values(serviceToRow(s))
              .onConflictDoUpdate({ target: schema.services.id, set: serviceToRow(s) }).run();
            s.defaults.forEach(pid =>
              tx.insert(schema.serviceProducts).values({ serviceId: s.id, productId: pid, type: 'default' }).run()
            );
            s.recommended.forEach(pid =>
              tx.insert(schema.serviceProducts).values({ serviceId: s.id, productId: pid, type: 'recommended' }).run()
            );
          });
        });
      }
      return next;
    });
  };

  const setSchedule: React.Dispatch<React.SetStateAction<Schedule>> = (action) => {
    setScheduleState(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (loadedRef.current) {
        db.transaction((tx) => {
          tx.delete(schema.schedule).run();
          Object.entries(next).forEach(([day, info]) =>
            tx.insert(schema.schedule).values({ day: Number(day), ...info }).run()
          );
        });
      }
      return next;
    });
  };

  const resetToDemo = () => {
    setClients(CLIENTS);
    setProducts(PRODUCTS);
    setAppointments(WEEK_APPOINTMENTS);
    setServices(SERVICES);
    setSchedule(DEFAULT_SCHEDULE);
  };

  const loadFromExport = (data: ExportPayload) => {
    setClients(data.clients);
    setProducts(data.products);
    setAppointments(data.appointments);
    setServices(data.services);
    setSchedule(data.schedule);
  };

  const base = dark ? darkTheme : lightTheme;
  const theme: Theme = { ...base, accent };

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAF6F0', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 22, fontWeight: '600', color: '#1C100A', marginBottom: 12 }}>
          Couldn't load your data
        </Text>
        <Text style={{ fontSize: 15, color: '#6B5D52', textAlign: 'center', lineHeight: 22, marginBottom: 16 }}>
          Iris couldn't open its database. Close and reopen the app — if this keeps
          happening, the app may need to be reinstalled.
        </Text>
        <Text style={{ fontSize: 12, color: '#9A8C80', textAlign: 'center' }}>
          {loadError.message}
        </Text>
      </View>
    );
  }

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAF6F0', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#C26E4A" />
      </View>
    );
  }

  return (
    <AppContext.Provider value={{
      theme, accent, dark, setAccent, setDark,
      studioName, setStudioName,
      clients, setClients,
      products, setProducts,
      appointments, setAppointments,
      services, setServices,
      schedule, setSchedule,
      density, setDensity,
      bookingWindowDays, setBookingWindowDays,
      lastExportAt, markExported,
      remindersEnabled, setRemindersEnabled,
      reminderLeadMinutes, setReminderLeadMinutes,
      resetToDemo, loadFromExport,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
