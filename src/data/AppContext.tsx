import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, AppState as RNAppState } from 'react-native';
import { Client, Product, Appointment, Service, Schedule, ExportPayload } from './types';
import { lightTheme, darkTheme, Theme, accentOptions } from '../theme';
import { db } from '../db';
import { eq, inArray } from 'drizzle-orm';
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
import { configureFormats, deviceUses24HourClock } from './utils';
import { getOrCreateIrisCalendar, syncAppointmentsToCalendar, deleteCalendarEvents } from './calendarSync';
import { pullSync, pushSync, syncPhotos } from './syncEngine';
import { sanitizePayload } from './sanitize';
import { writeAutoBackup } from './backup';
import { diffById } from './diff';

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

  vatRate: number;
  setVatRate: (n: number) => void;
  currency: string;
  setCurrency: (c: string) => void;
  hour24: boolean;
  setHour24: (v: boolean) => void;

  tombstones: Record<string, number>;
  setTombstones: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  calendarSyncEnabled: boolean;
  setCalendarSyncEnabled: (v: boolean) => void;

  iCloudSyncEnabled: boolean;
  setICloudSyncEnabled: (v: boolean) => void;

  appleCalendarId: string | null;
  setAppleCalendarId: (v: string | null) => void;

  resetToDemo: () => void;
  loadFromExport: (payload: ExportPayload) => Promise<void>;
  forceSync: () => Promise<boolean>;
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
  const [vatRate, setVatRateState] = useState(20);
  const [currency, setCurrencyState] = useState('£');
  const [hour24, setHour24State] = useState(false);
  const [calendarSyncEnabled, setCalendarSyncEnabledState] = useState(false);
  const [iCloudSyncEnabled, setICloudSyncEnabledState] = useState(false);
  const [appleCalendarId, setAppleCalendarIdState] = useState<string | null>(null);
  const [lastExportAt, setLastExportAtState] = useState<string | null>(null);
  const [tombstones, setTombstonesState] = useState<Record<string, number>>({});

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
      if (get('vatRate'))             setVatRateState(Number(get('vatRate')));
      // Display formats: currency symbol and clock convention. The clock defaults to
      // the device's own preference until the user picks one explicitly.
      const savedCurrency = get('currency') ?? '£';
      const savedHour24 = get('hour24') !== undefined ? get('hour24') === 'true' : deviceUses24HourClock();
      configureFormats({ currency: savedCurrency, hour24: savedHour24 });
      setCurrencyState(savedCurrency);
      setHour24State(savedHour24);
      if (get('calendarSyncEnabled')) setCalendarSyncEnabledState(get('calendarSyncEnabled') === 'true');
      if (get('iCloudSyncEnabled'))   setICloudSyncEnabledState(get('iCloudSyncEnabled') === 'true');
      if (get('appleCalendarId'))     setAppleCalendarIdState(get('appleCalendarId')!);
      if (get('lastExportAt'))        setLastExportAtState(get('lastExportAt')!);
      if (get('tombstones'))          setTombstonesState(JSON.parse(get('tombstones')!));

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
  const setVatRate = (n: number) => { setVatRateState(n); setSetting('vatRate', String(n)); };
  const setCurrency = (c: string) => { configureFormats({ currency: c }); setCurrencyState(c); setSetting('currency', c); };
  const setHour24 = (v: boolean) => { configureFormats({ hour24: v }); setHour24State(v); setSetting('hour24', String(v)); };
  const setCalendarSyncEnabled = (v: boolean) => { setCalendarSyncEnabledState(v); setSetting('calendarSyncEnabled', String(v)); };
  const setICloudSyncEnabled = (v: boolean) => { setICloudSyncEnabledState(v); setSetting('iCloudSyncEnabled', String(v)); };
  const setAppleCalendarId = (v: string | null) => { setAppleCalendarIdState(v); if (v) setSetting('appleCalendarId', v); };

  useEffect(() => { setupNotificationChannel(); }, []);

  // Keep scheduled appointment reminders in sync with the data and reminder settings.
  useEffect(() => {
    if (!loaded) return;
    syncAppointmentReminders(appointments, clients, reminderLeadMinutes, remindersEnabled).catch(() => {});
  }, [loaded, appointments, clients, reminderLeadMinutes, remindersEnabled]);

  // Keep Apple Calendar in sync.
  //
  // The effect re-fires whenever `appointments` changes — including its own
  // writes (the sync sets each appointment's `appleEventId`). To stop that
  // becoming an infinite loop (especially in failure paths where the sync
  // keeps reassigning the id to whichever "duplicate" it finds), we hash the
  // inputs the calendar actually cares about — id / start / end / status /
  // clientId / service / notes — and skip if that hash hasn't changed since
  // the last sync. `appleEventId` is the OUTPUT of this effect and is
  // deliberately excluded.
  const syncingRef = useRef(false);
  const lastSyncSigRef = useRef<string>('');
  useEffect(() => {
    if (!loaded || !calendarSyncEnabled || !appleCalendarId || syncingRef.current) return;

    const sig = appointments
      .map(a => `${a.id}|${a.start}|${a.end}|${a.status}|${a.clientId}|${a.service}|${a.notes ?? ''}`)
      .join(';');
    if (sig === lastSyncSigRef.current) return;

    let cancelled = false;
    syncingRef.current = true;
    syncAppointmentsToCalendar(appleCalendarId, appointments, clients)
      .then(updated => {
        if (cancelled) return;
        // If sync modified the appointments (added appleEventId), save them
        const changed = updated.filter((u, i) => u.appleEventId !== appointments[i].appleEventId);
        if (changed.length > 0) {
          db.transaction(() => {
            for (const appt of changed) {
              db.update(schema.appointments)
                .set({ appleEventId: appt.appleEventId ?? null })
                .where(eq(schema.appointments.id, appt.id)).run();
            }
          });
          setAppointmentsState(updated);
        }
        // Mark this input state as synced. The re-render triggered by the
        // setState above will compute the same sig (appleEventId excluded)
        // and bail at the early return.
        lastSyncSigRef.current = sig;
      })
      .finally(() => {
        syncingRef.current = false;
      });

    return () => { cancelled = true; };
  }, [loaded, calendarSyncEnabled, appleCalendarId, appointments, clients]);

  // Allow a retry after the user toggles sync off and back on (e.g. after
  // granting permission), even if the appointments themselves haven't changed.
  useEffect(() => {
    if (!calendarSyncEnabled) lastSyncSigRef.current = '';
  }, [calendarSyncEnabled]);

  const markExported = () => {
    const now = new Date().toISOString();
    setLastExportAtState(now);
    setSetting('lastExportAt', now);
  };

  // Latest data snapshot, kept current for the on-background auto-backup.
  const snapshotRef = useRef<ExportPayload>({
    version: 1, exported: '', clients: [], products: [], appointments: [], services: [], schedule: {}, tombstones: {},
  });
  snapshotRef.current = {
    version: 1,
    exported: new Date().toISOString(),
    clients, products, appointments, services, schedule, tombstones,
  };

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'background' && loadedRef.current) {
        writeAutoBackup(snapshotRef.current);
        if (iCloudSyncEnabled) {
          pushSync(snapshotRef.current).catch(() => {});
          const allPhotos = clients.flatMap(c => c.photos ?? []);
          syncPhotos(allPhotos).catch(() => {});
        }
      } else if (state === 'active' && loadedRef.current && iCloudSyncEnabled) {
        pullSync(snapshotRef.current).then(merged => {
          if (merged) {
            setClients(merged.clients);
            setProducts(merged.products);
            setAppointments(merged.appointments);
            setServices(merged.services);
            setSchedule(merged.schedule);
            const allPhotos = merged.clients.flatMap(c => c.photos ?? []);
            syncPhotos(allPhotos).catch(() => {});
          }
        }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [iCloudSyncEnabled, clients]);

  useEffect(() => {
    if (iCloudSyncEnabled && loadedRef.current) {
      forceSync().catch(() => {});
    }
  }, [iCloudSyncEnabled]);

  useEffect(() => {
    if (!iCloudSyncEnabled || !loadedRef.current) return;
    const timer = setTimeout(() => {
      pushSync(snapshotRef.current).catch(() => {});
      const allPhotos = clients.flatMap(c => c.photos ?? []);
      syncPhotos(allPhotos).catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [iCloudSyncEnabled, clients, products, appointments, services, schedule]);

  // Polling mechanism to pull changes automatically while the app is open
  // This is especially helpful when two devices are open side-by-side (like simulators)
  // or when a user leaves the app open on a counter for long periods.
  useEffect(() => {
    if (!iCloudSyncEnabled || !loadedRef.current) return;
    const interval = setInterval(() => {
      pullSync(snapshotRef.current).catch(() => null).then(merged => {
        if (merged) {
          setClients(merged.clients);
          setProducts(merged.products);
          setAppointments(merged.appointments);
          setServices(merged.services);
          setSchedule(merged.schedule);

          snapshotRef.current = {
            version: 1,
            exported: new Date().toISOString(),
            clients: merged.clients,
            products: merged.products,
            appointments: merged.appointments,
            services: merged.services,
            schedule: merged.schedule,
            tombstones: merged.tombstones,
          };
        }
      });
    }, 15000); // Poll every 15 seconds
    return () => clearInterval(interval);
  }, [iCloudSyncEnabled]);

  const forceSync = async (): Promise<boolean> => {
    if (!iCloudSyncEnabled) return false;
    let didPull = false;
    const merged = await pullSync(snapshotRef.current);
    if (merged) {
      didPull = true;
      setClients(merged.clients);
      setProducts(merged.products);
      setAppointments(merged.appointments);
      setServices(merged.services);
      setSchedule(merged.schedule);
      
      // Update snapshot ref instantly before pushing
      snapshotRef.current = {
        version: 1,
        exported: new Date().toISOString(),
        clients: merged.clients,
        products: merged.products,
        appointments: merged.appointments,
        services: merged.services,
        schedule: merged.schedule,
        tombstones: merged.tombstones,
      };
    }
    
    // Explicitly push the newly merged (or current) state immediately
    await pushSync(snapshotRef.current);
    return didPull;
  };

  const registerTombstones = (removed: { id: string }[]) => {
    if (removed.length === 0) return;
    setTombstonesState(curr => {
      const up = { ...curr };
      const now = Date.now();
      removed.forEach(r => up[r.id] = now);
      setSetting('tombstones', JSON.stringify(up));
      return up;
    });
  };

  const setClients: React.Dispatch<React.SetStateAction<Client[]>> = (action) => {
    setClientsState(prev => {
      let next = typeof action === 'function' ? action(prev) : action;
      if (typeof action === 'function') {
        const prevById = new Map(prev.map(p => [p.id, p]));
        next = next.map(item => {
          const prevItem = prevById.get(item.id);
          return prevItem !== item ? { ...item, updatedAt: Date.now() } : item;
        });
      }
      const { removed, changed } = diffById(prev, next);
      registerTombstones(removed);
      if (loadedRef.current && (removed.length > 0 || changed.length > 0)) {
        db.transaction((tx) => {
          if (removed.length > 0) {
            const ids = removed.map(c => c.id);
            tx.delete(schema.clientPhotos).where(inArray(schema.clientPhotos.clientId, ids)).run();
            tx.delete(schema.clients).where(inArray(schema.clients.id, ids)).run();
          }
          changed.forEach(c => {
            tx.insert(schema.clients).values(clientToRow(c))
              .onConflictDoUpdate({ target: schema.clients.id, set: clientToRow(c) }).run();
            tx.delete(schema.clientPhotos).where(eq(schema.clientPhotos.clientId, c.id)).run();
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
      let next = typeof action === 'function' ? action(prev) : action;
      if (typeof action === 'function') {
        const prevById = new Map(prev.map(p => [p.id, p]));
        next = next.map(item => {
          const prevItem = prevById.get(item.id);
          return prevItem !== item ? { ...item, updatedAt: Date.now() } : item;
        });
      }
      const { removed, changed } = diffById(prev, next);
      registerTombstones(removed);
      if (loadedRef.current && (removed.length > 0 || changed.length > 0)) {
        db.transaction((tx) => {
          if (removed.length > 0) {
            tx.delete(schema.products).where(inArray(schema.products.id, removed.map(p => p.id))).run();
          }
          changed.forEach(p =>
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
      let next = typeof action === 'function' ? action(prev) : action;
      if (typeof action === 'function') {
        const prevById = new Map(prev.map(p => [p.id, p]));
        next = next.map(item => {
          const prevItem = prevById.get(item.id);
          return prevItem !== item ? { ...item, updatedAt: Date.now() } : item;
        });
      }
      const { removed, changed } = diffById(prev, next);
      registerTombstones(removed);
      // Appointments removed outright (client delete, sync tombstones) skip the
      // calendar-sync effect, so their Apple Calendar events must be cleaned up here.
      const removedEventIds = removed
        .filter(p => p.appleEventId)
        .map(p => p.appleEventId!);
      if (removedEventIds.length > 0) deleteCalendarEvents(removedEventIds);
      if (loadedRef.current && (removed.length > 0 || changed.length > 0)) {
        db.transaction((tx) => {
          if (removed.length > 0) {
            const ids = removed.map(a => a.id);
            tx.delete(schema.appointmentProducts).where(inArray(schema.appointmentProducts.appointmentId, ids)).run();
            tx.delete(schema.appointments).where(inArray(schema.appointments.id, ids)).run();
          }
          changed.forEach(a => {
            tx.insert(schema.appointments).values(appointmentToRow(a))
              .onConflictDoUpdate({ target: schema.appointments.id, set: appointmentToRow(a) }).run();
            tx.delete(schema.appointmentProducts).where(eq(schema.appointmentProducts.appointmentId, a.id)).run();
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
      let next = typeof action === 'function' ? action(prev) : action;
      if (typeof action === 'function') {
        const prevById = new Map(prev.map(p => [p.id, p]));
        next = next.map(item => {
          const prevItem = prevById.get(item.id);
          return prevItem !== item ? { ...item, updatedAt: Date.now() } : item;
        });
      }
      const { removed, changed } = diffById(prev, next);
      registerTombstones(removed);
      if (loadedRef.current && (removed.length > 0 || changed.length > 0)) {
        db.transaction((tx) => {
          if (removed.length > 0) {
            const ids = removed.map(s => s.id);
            tx.delete(schema.serviceProducts).where(inArray(schema.serviceProducts.serviceId, ids)).run();
            tx.delete(schema.services).where(inArray(schema.services.id, ids)).run();
          }
          changed.forEach(s => {
            tx.insert(schema.services).values(serviceToRow(s))
              .onConflictDoUpdate({ target: schema.services.id, set: serviceToRow(s) }).run();
            tx.delete(schema.serviceProducts).where(eq(schema.serviceProducts.serviceId, s.id)).run();
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

  const loadFromExport = async (raw: ExportPayload) => {
    const data = sanitizePayload(raw);
    setClients(data.clients);
    setProducts(data.products);
    setAppointments(data.appointments);
    setServices(data.services);
    setSchedule(data.schedule);
    if (data.tombstones) {
      setTombstonesState(data.tombstones);
      setSetting('tombstones', JSON.stringify(data.tombstones));
    }
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
      remindersEnabled, setRemindersEnabled,
      reminderLeadMinutes, setReminderLeadMinutes,
      vatRate, setVatRate,
      currency, setCurrency,
      hour24, setHour24,
      calendarSyncEnabled, setCalendarSyncEnabled,
      iCloudSyncEnabled, setICloudSyncEnabled,
      appleCalendarId, setAppleCalendarId,
      tombstones, setTombstones: setTombstonesState,
      lastExportAt, markExported,
      resetToDemo,
      loadFromExport,
      forceSync,
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
