import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, AppState as RNAppState } from 'react-native';
import { Client, Product, Appointment, Service, Schedule, ExportPayload } from './types';
import { DayOff, serviceRanges } from './daysOff';
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
import { Backend, LocalBackend, backendFor } from './backend';
import { loadCredentials } from './bookingStore';
import { probeService } from './bookingApi';
import { runIntake, type IntakeReport } from './intake';
import { applyIntakePlan } from './intakeStore';
import { inboxFor } from './inboxFor';
import { clientIdForRef } from './clientRef';
import { clientIdForRef as clientIdFromSentLinks } from '../db/bookingLinks';
import {
  cancelOnService, fetchMoneyAlerts, dismissMoneyAlert as dismissOnService, putDaysOffOnService,
  type MoneyAlert,
} from './bookingApi';
import {
  enqueue as enqueueWebCancel, flush as flushWebCancels, pending as pendingWebCancels, withdraw as withdrawQueuedCancel,
  webBookingIdOf, type QueueStore, type Withdrawal,
} from './webCancels';
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

  /** Days she has blocked off — the exceptions to her weekly hours. */
  daysOff: DayOff[];
  setDaysOff: React.Dispatch<React.SetStateAction<DayOff[]>>;
  /** Sends her days off to the booking service again — after the salon is registered there. */
  resendDaysOff: () => Promise<void>;

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

  /** Off unless she runs her own booking service — hides the feature entirely. */
  bookingEnabled: boolean;
  /**
   * What this device can actually do — no server, her own, or one run for her.
   * Screens ask this rather than inspecting credentials or checking a mode.
   */
  backend: Backend;
  /** Call after linking or unlinking a device. */
  refreshBackend: () => Promise<void>;
  setBookingEnabled: (v: boolean) => void;

  /**
   * Pulls bookings made on the web into the diary. Safe to call repeatedly —
   * a booking already here is recognised, not duplicated.
   */
  importBookings: () => Promise<IntakeReport | null>;

  /**
   * Tells the service she has cancelled a web booking, so the hour is freed
   * and any deposit refunded. Written down first, so it gets there even if
   * she has no signal now. `reached` is whether it got there this time.
   */
  cancelWebBooking: (appointmentId: string, refund: 'full' | 'policy') => Promise<{ reached: boolean }>;
  /**
   * She pressed undo. `withdrawn` — it had not reached the service, so it never
   * will; `sent` — this device delivered it, so the service has cancelled it
   * (and any refund is on its way) and undoing changes only her diary;
   * `unknown` — this device never sent one, so whether the service still holds
   * the booking is not known here.
   */
  withdrawWebCancel: (appointmentId: string) => Withdrawal | 'not-web';

  /** Disputes, failed refunds and stray payments — money that needs her. */
  moneyAlerts: MoneyAlert[];
  refreshMoneyAlerts: () => Promise<void>;
  dismissMoneyAlert: (id: string) => Promise<void>;

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
  const [daysOff, setDaysOffState] = useState<DayOff[]>([]);
  const [density, setDensityState] = useState<'compact' | 'regular' | 'comfy'>('regular');
  const [bookingWindowDays, setBookingWindowDaysState] = useState(90);
  const [remindersEnabled, setRemindersEnabledState] = useState(false);
  const [reminderLeadMinutes, setReminderLeadMinutesState] = useState(60);
  const [vatRate, setVatRateState] = useState(20);
  const [currency, setCurrencyState] = useState('£');
  const [hour24, setHour24State] = useState(false);
  const [calendarSyncEnabled, setCalendarSyncEnabledState] = useState(false);
  const [bookingEnabled, setBookingEnabledState] = useState(false);
  // Starts local so the app is useful on first paint; the real one arrives a
  // moment later, and on a train it simply never does, which is fine.
  const [backend, setBackend] = useState<Backend>(() => new LocalBackend());
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

      setDaysOffState(readDaysOff());

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
      if (get('bookingEnabled'))      setBookingEnabledState(get('bookingEnabled') === 'true');
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
    writeSetting(key, value);
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
  const setBookingEnabled = (v: boolean) => { setBookingEnabledState(v); setSetting('bookingEnabled', String(v)); };

  /**
   * Brings web bookings into the diary.
   *
   * The ordering here is the one that cannot lose a booking: the rows are
   * committed to SQLite first, and only then is the service told. If this is
   * killed in between, the service re-offers the booking and intake recognises
   * the appointment it already wrote — a duplicate delivery, never a lost
   * Saturday.
   *
   * Returns null when there is nothing to read from, which is the ordinary
   * state of a device that has never been set up for online booking.
   */
  /** The waiting-to-send cancellations, kept in the settings table on this device. */
  const webCancelStore: QueueStore = {
    read: () => settingValue('pendingWebCancels'),
    write: (value) => { writeSetting('pendingWebCancels', value); },
  };
  /** The ones the service acknowledged — so Undo only says "already refunded" when it was. */
  const deliveredCancelStore: QueueStore = {
    read: () => settingValue('sentWebCancels'),
    write: (value) => { writeSetting('sentWebCancels', value); },
  };

  const sendWaitingCancels = async () => {
    const creds = await loadCredentials().catch(() => null);
    if (!creds) return { sent: 0, waiting: 0 };
    return flushWebCancels(webCancelStore, (item) => cancelOnService(creds, item), deliveredCancelStore);
  };

  const cancelWebBooking = async (appointmentId: string, refund: 'full' | 'policy') => {
    const bookingId = webBookingIdOf(appointmentId);
    if (!bookingId) return { reached: true };
    // Written down BEFORE it is sent: if the app is closed or the signal drops
    // mid-request, the next pull sends it again.
    enqueueWebCancel(webCancelStore, { bookingId, refund, cancelledAt: Date.now() });
    await sendWaitingCancels().catch(() => {});
    // Whether THIS one got there — not whether the queue is empty. An older
    // cancellation still waiting must not make this one look unsent.
    return { reached: !pendingWebCancels(webCancelStore).some((p) => p.bookingId === bookingId) };
  };

  const withdrawWebCancel = (appointmentId: string): Withdrawal | 'not-web' => {
    const bookingId = webBookingIdOf(appointmentId);
    if (!bookingId) return 'not-web';
    return withdrawQueuedCancel(webCancelStore, bookingId, deliveredCancelStore);
  };

  const [moneyAlerts, setMoneyAlerts] = useState<MoneyAlert[]>([]);
  const refreshMoneyAlerts = async () => {
    const creds = await loadCredentials().catch(() => null);
    // Only a service that takes deposits has money to warn about.
    if (!creds || !backend.has('deposits')) { setMoneyAlerts([]); return; }
    setMoneyAlerts(await fetchMoneyAlerts(creds));
  };
  const dismissMoneyAlert = async (id: string) => {
    const creds = await loadCredentials().catch(() => null);
    if (!creds) return;
    await dismissOnService(creds, id);
    setMoneyAlerts(prev => prev.filter(a => a.id !== id));
  };

  /**
   * One pull at a time. Two overlapping pulls plan against the same snapshot,
   * and both used to append the same appointment to the screen. A second call
   * while one is running gets the running one's result.
   */
  const importing = useRef<Promise<IntakeReport | null> | null>(null);
  const importBookings = (): Promise<IntakeReport | null> => {
    if (!importing.current) {
      importing.current = pullBookings().finally(() => { importing.current = null; });
    }
    return importing.current;
  };

  const pullBookings = async (): Promise<IntakeReport | null> => {
    const creds = await loadCredentials().catch(() => null);
    if (!creds) return null;

    // Her cancellations and days off go out before anything comes in: a change
    // made with no signal reaches the service as soon as there is one.
    await sendWaitingCancels().catch(() => {});
    await pushDaysOffIfNeeded().catch(() => {});

    const inbox = inboxFor(creds);
    const incoming = await inbox.fetchBookings();
    if (incoming.length === 0) {
      return {
        added: 0, redelivered: 0, newClients: 0, cancelled: 0, cardsUpdated: 0,
        needsAttention: [], unacknowledged: [], stuck: [],
      };
    }

    // Read straight from the database rather than from React state: state may
    // be a render behind, and being a render behind here means writing a second
    // copy of an appointment that is already in the diary.
    const knownClients = db.select().from(schema.clients).all().map(r => rowToClient(r, []));
    const knownAppts = db.select().from(schema.appointments).all().map(r => rowToAppointment(r, []));

    const report = await runIntake(incoming, {
      clients: knownClients,
      appointments: knownAppts,
      apply: async (plan) => {
        // Counted as a local write BEFORE anything else, so an iCloud pull
        // already in flight is dropped instead of deleting these rows.
        localWrites.current++;
        applyIntakePlan(plan);
        // Only once it is on disk does the screen learn about it. State
        // following the database, never the other way round.
        // Never appended twice: an iCloud pull can bring the same booking's
        // appointment (same id) from her other device in the meantime, and the
        // database already ignored the duplicate — the screen must too.
        if (plan.newClients.length || plan.clientUpdates.length) {
          const updates = new Map(plan.clientUpdates.map(u => [u.id, u.patch]));
          setClientsState(prev => {
            const have = new Set(prev.map(c => c.id));
            return [
              ...prev.map(c => (updates.has(c.id) ? { ...c, ...updates.get(c.id) } : c)),
              ...plan.newClients.filter(c => !have.has(c.id)),
            ];
          });
        }
        if (plan.appointments.length || plan.cancellations.length) {
          const cancelled = new Map(plan.cancellations.map(c => [c.id, c]));
          setAppointmentsState(prev => {
            const have = new Set(prev.map(a => a.id));
            return [
              ...prev.map(a => {
                const c = cancelled.get(a.id);
                return c ? { ...a, status: 'cancelled' as const, notes: c.notes, updatedAt: c.updatedAt } : a;
              }),
              ...plan.appointments.filter(a => !have.has(a.id)),
            ];
          });
        }
      },
      markSeen: (id) => inbox.markBookingSeen(id),
      // What she deleted stays deleted, even if the service keeps offering it.
      deleted: Object.keys(snapshotRef.current.tombstones ?? {}),
      // The client a link was sent to is sealed inside it; any of her devices
      // can open it. Links from before that fall back to this device's record.
      clientForRef: (ref) => clientIdForRef(ref, creds.keyPair.secretKey, clientIdFromSentLinks),
    });
    if (report.stuck.length) {
      console.warn('bookings that cannot be acknowledged (written before versioning):', report.stuck);
    }

    return report;
  };

  const refreshBackend = async () => {
    const creds = await loadCredentials().catch(() => null);
    const next = backendFor(creds, { probe: probeService });
    // Asking is best-effort: a service that cannot be reached keeps the
    // capabilities its mode implies, so the app degrades rather than going dark.
    await next.health().catch(() => {});
    setBackend(next);
  };

  useEffect(() => { refreshBackend(); }, [bookingEnabled]);
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
    version: 1, exported: '', clients: [], products: [], appointments: [], services: [], schedule: {}, daysOff: [], tombstones: {},
  });
  snapshotRef.current = {
    version: 1,
    exported: new Date().toISOString(),
    clients, products, appointments, services, schedule, daysOff, tombstones,
  };

  /**
   * Bumped, synchronously, by every local write.
   *
   * An iCloud pull merges against the snapshot taken when it STARTED. Applying
   * that merge after something was written here in the meantime — a booking
   * brought in from the web, or her own edit — replaces the newer local state
   * with the older one, and the diffing setters then delete the difference and
   * tombstone it, so it is gone on every device and never comes back. So a pull
   * only applies if nothing was written while it was in flight; otherwise it is
   * dropped, and the next pull starts from the current state.
   */
  const localWrites = useRef(0);

  /** Applies a pull's merge, unless it has gone stale. True if applied. */
  const applyPull = (merged: ExportPayload | null, startedAt: number): boolean => {
    if (!merged || localWrites.current !== startedAt) return false;
    setClients(merged.clients);
    setProducts(merged.products);
    setAppointments(merged.appointments);
    setServices(merged.services);
    setSchedule(merged.schedule);
    if (merged.daysOff) setDaysOff(merged.daysOff);
    snapshotRef.current = {
      version: 1,
      exported: new Date().toISOString(),
      clients: merged.clients,
      products: merged.products,
      appointments: merged.appointments,
      services: merged.services,
      schedule: merged.schedule,
      daysOff: merged.daysOff ?? snapshotRef.current.daysOff,
      tombstones: merged.tombstones,
    };
    return true;
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
        const startedAt = localWrites.current;
        pullSync(snapshotRef.current).then(merged => {
          if (merged && applyPull(merged, startedAt)) {
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
  }, [iCloudSyncEnabled, clients, products, appointments, services, schedule, daysOff]);

  // Polling mechanism to pull changes automatically while the app is open
  // This is especially helpful when two devices are open side-by-side (like simulators)
  // or when a user leaves the app open on a counter for long periods.
  useEffect(() => {
    if (!iCloudSyncEnabled || !loadedRef.current) return;
    const interval = setInterval(() => {
      const startedAt = localWrites.current;
      pullSync(snapshotRef.current).catch(() => null).then(merged => {
        applyPull(merged, startedAt);
      });
    }, 15000); // Poll every 15 seconds
    return () => clearInterval(interval);
  }, [iCloudSyncEnabled]);

  const forceSync = async (): Promise<boolean> => {
    if (!iCloudSyncEnabled) return false;
    const startedAt = localWrites.current;
    const merged = await pullSync(snapshotRef.current);
    // A stale pull is dropped rather than applied; the push below still merges
    // with the remote copy, so nothing on either side is lost by skipping it.
    const didPull = applyPull(merged, startedAt);

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
    localWrites.current++;
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
    localWrites.current++;
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
    localWrites.current++;
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
    localWrites.current++;
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

  /** Her days off as stored. Read from the database, never React state, by anything that must not be a render behind. */
  const readDaysOff = (): DayOff[] => db.select().from(schema.daysOff).all().map(r => ({
    id: r.id, start: r.start, end: r.end,
    ...(r.note ? { note: r.note } : {}),
    ...(r.updatedAt != null ? { updatedAt: r.updatedAt } : {}),
  }));

  const settingValue = (key: string) =>
    db.select().from(schema.settings).where(eq(schema.settings.key, key)).all()[0]?.value ?? null;
  const writeSetting = (key: string, value: string) =>
    db.insert(schema.settings).values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();

  /**
   * Tells the booking service her days off, if it has not heard the latest.
   *
   * A version, not a flag: she may block another day while a push is in
   * flight, and a flag cleared by the older push would leave the newer day
   * unsent. Retried on every pull, so a day blocked with no signal still
   * reaches the service as soon as there is one.
   *
   * The whole list each time. Whichever device pushes last after iCloud has
   * merged both lists leaves the service right.
   */
  const pushDaysOffIfNeeded = async () => {
    const creds = await loadCredentials().catch(() => null);
    if (!creds) return;
    // "Sent" means sent to THIS service at THIS version. Remembering only the
    // version meant a newly linked service was never told about a holiday she
    // had already blocked.
    const marker = `${creds.serviceUrl}#${settingValue('daysOffVersion') ?? '0'}`;
    if (settingValue('daysOffSent') === marker) return;
    const sent = await putDaysOffOnService(creds, serviceRanges(readDaysOff()));
    if (sent === 'done') writeSetting('daysOffSent', marker);
  };

  /** After the salon is (re)registered — a reset service has forgotten her days off. */
  const resendDaysOff = async () => {
    writeSetting('daysOffSent', '');
    await pushDaysOffIfNeeded();
  };

  const setDaysOff: React.Dispatch<React.SetStateAction<DayOff[]>> = (action) => {
    localWrites.current++;
    setDaysOffState(prev => {
      let next = typeof action === 'function' ? action(prev) : action;
      if (typeof action === 'function') {
        const prevById = new Map(prev.map(p => [p.id, p]));
        next = next.map(item => (prevById.get(item.id) !== item ? { ...item, updatedAt: Date.now() } : item));
      }
      const { removed, changed } = diffById(prev, next);
      registerTombstones(removed);
      if (loadedRef.current && (removed.length > 0 || changed.length > 0)) {
        db.transaction((tx) => {
          if (removed.length > 0) {
            tx.delete(schema.daysOff).where(inArray(schema.daysOff.id, removed.map(d => d.id))).run();
          }
          changed.forEach(d => {
            const row = { id: d.id, start: d.start, end: d.end, note: d.note ?? null, updatedAt: d.updatedAt ?? Date.now() };
            tx.insert(schema.daysOff).values(row).onConflictDoUpdate({ target: schema.daysOff.id, set: row }).run();
          });
        });
        writeSetting('daysOffVersion', String(Number(settingValue('daysOffVersion') ?? '0') + 1));
        // After this update has been applied, not inside it.
        setTimeout(() => { pushDaysOffIfNeeded().catch(() => {}); }, 0);
      }
      return next;
    });
  };

  const setSchedule: React.Dispatch<React.SetStateAction<Schedule>> = (action) => {
    localWrites.current++;
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
    setDaysOff([]);
  };

  const loadFromExport = async (raw: ExportPayload) => {
    const data = sanitizePayload(raw);
    setClients(data.clients);
    setProducts(data.products);
    setAppointments(data.appointments);
    setServices(data.services);
    setSchedule(data.schedule);
    setDaysOff(data.daysOff ?? []);
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
      daysOff, setDaysOff, resendDaysOff,
      density, setDensity,
      bookingWindowDays, setBookingWindowDays,
      remindersEnabled, setRemindersEnabled,
      reminderLeadMinutes, setReminderLeadMinutes,
      vatRate, setVatRate,
      currency, setCurrency,
      hour24, setHour24,
      calendarSyncEnabled, setCalendarSyncEnabled,
      bookingEnabled, setBookingEnabled,
      backend, refreshBackend, importBookings,
      cancelWebBooking, withdrawWebCancel, moneyAlerts, refreshMoneyAlerts, dismissMoneyAlert,
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
