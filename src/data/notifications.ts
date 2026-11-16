import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Appointment, Client } from './types';
import { fmt } from './utils';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Iris',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/** Asks for notification permission if not already granted. Returns whether it's granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// iOS silently drops scheduled notifications beyond 64 pending, so schedule the
// soonest reminders first and leave headroom for the immediate low-stock alerts.
const MAX_SCHEDULED_REMINDERS = 60;

/**
 * Clears all scheduled notifications and, when enabled, reschedules one reminder per
 * future `upcoming` appointment whose reminder time is still ahead. Cancel-all then
 * reschedule keeps things simple and correct for a solo salon's appointment volume.
 */
export async function syncAppointmentReminders(
  appointments: Appointment[],
  clients: Client[],
  leadMinutes: number,
  enabled: boolean,
): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!enabled) return;

  const now = Date.now();
  const upcoming = appointments
    .filter((a) => a.status === 'upcoming')
    .map((a) => ({ appt: a, fireAt: new Date(new Date(a.start).getTime() - leadMinutes * 60_000) }))
    .filter(({ fireAt }) => fireAt.getTime() > now)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, MAX_SCHEDULED_REMINDERS);

  for (const { appt, fireAt } of upcoming) {
    const client = clients.find((c) => c.id === appt.clientId);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: client ? `${client.name} — ${appt.service}` : appt.service,
        body: `Starts at ${fmt.time(appt.start)}`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
  }
}

/** Fires an immediate notification when a product crosses into low/out of stock. */
export async function notifyLowStock(productName: string, isOut: boolean): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: isOut ? `${productName} is out of stock` : `${productName} is running low`,
      body: 'Tap to review your inventory.',
    },
    trigger: null,
  });
}
