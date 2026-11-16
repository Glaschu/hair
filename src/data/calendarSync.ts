import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { Appointment, Client } from './types';

const CALENDAR_TITLE = 'Iris Appointments';

export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

export async function getOrCreateIrisCalendar(): Promise<string | null> {
  const hasPermission = await requestCalendarPermissions();
  if (!hasPermission) return null;

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = calendars.find(c => c.title === CALENDAR_TITLE);
  if (existing) return existing.id;

  let sourceId: string | undefined;

  if (Platform.OS === 'ios') {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    sourceId = defaultCalendar.source.id;
  } else {
    // For Android, usually you'd need an account source. 
    // We try to find a suitable source or fallback.
    const sources = await Calendar.getSourcesAsync();
    const source = sources.find(s => s.type === Calendar.SourceType.LOCAL) 
      || sources.find(s => s.isLocalAccount)
      || sources[0];
    sourceId = source?.id;
  }

  if (!sourceId) return null;

  try {
    const newCalendarId = await Calendar.createCalendarAsync({
      title: CALENDAR_TITLE,
      color: '#C26E4A',
      entityType: Calendar.EntityTypes.EVENT,
      sourceId,
      source: {
        isLocalAccount: true,
        name: CALENDAR_TITLE,
        id: sourceId,
        type: Calendar.SourceType.LOCAL,
      },
      name: CALENDAR_TITLE,
      ownerAccount: 'personal',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return newCalendarId;
  } catch (error) {
    console.error('Failed to create calendar', error);
    return null;
  }
}

/**
 * Best-effort removal of calendar events whose appointments no longer exist
 * (e.g. deleted along with a client). Events already gone are ignored.
 */
export async function deleteCalendarEvents(eventIds: string[]): Promise<void> {
  for (const id of eventIds) {
    try {
      await Calendar.deleteEventAsync(id);
    } catch {
      // already deleted, or calendar permission revoked — nothing to clean up
    }
  }
}

export async function deleteIrisCalendar(calendarId: string): Promise<void> {
  try {
    await Calendar.deleteCalendarAsync(calendarId);
  } catch (error) {
    console.error('Failed to delete calendar', error);
  }
}

/**
 * Creates, updates, or deletes calendar events to match the provided appointments.
 * Returns the updated appointments with `appleEventId` set.
 * If sync is disabled or fails, returns the appointments unchanged.
 */
export async function syncAppointmentsToCalendar(
  calendarId: string,
  appointments: Appointment[],
  clients: Client[]
): Promise<Appointment[]> {
  const hasPermission = await requestCalendarPermissions();
  if (!hasPermission) return appointments;

  const updatedAppointments = [...appointments];

  for (let i = 0; i < updatedAppointments.length; i++) {
    const appt = updatedAppointments[i];
    
    // Only sync future appointments or those completed recently.
    // Actually, simple rule: sync everything, but for safety maybe just those not cancelled/no-show.
    // Or just let's sync all active appointments.
    if (appt.status === 'cancelled' || appt.status === 'no-show') {
      if (appt.appleEventId) {
        try {
          await Calendar.deleteEventAsync(appt.appleEventId);
          updatedAppointments[i] = { ...appt, appleEventId: undefined };
        } catch {
          // Event might already be deleted manually
          updatedAppointments[i] = { ...appt, appleEventId: undefined };
        }
      }
      continue;
    }

    const client = clients.find(c => c.id === appt.clientId);
    const title = `${client?.name ?? 'Client'} - ${appt.service}`;
    const notes = appt.notes ? `Notes:\n${appt.notes}` : '';

    const eventDetails = {
      title,
      startDate: new Date(appt.start),
      endDate: new Date(appt.end),
      notes,
    };

    try {
      if (appt.appleEventId) {
        // Try to update
        try {
          await Calendar.updateEventAsync(appt.appleEventId, eventDetails);
        } catch {
          // If update fails (e.g. user deleted it, or it was from another device), 
          // check if it exists before recreating
          const startDay = new Date(appt.start); startDay.setHours(0, 0, 0, 0);
          const endDay = new Date(appt.end); endDay.setHours(23, 59, 59, 999);
          const existingEvents = await Calendar.getEventsAsync([calendarId], startDay, endDay);
          const duplicate = existingEvents.find(e => e.title === title && new Date(e.startDate).getTime() === new Date(appt.start).getTime());
          
          if (duplicate) {
            await Calendar.updateEventAsync(duplicate.id, eventDetails);
            updatedAppointments[i] = { ...appt, appleEventId: duplicate.id };
          } else {
            const newId = await Calendar.createEventAsync(calendarId, eventDetails);
            updatedAppointments[i] = { ...appt, appleEventId: newId };
          }
        }
      } else {
        // Create new, but check if it was created by another device first!
        const startDay = new Date(appt.start); startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(appt.end); endDay.setHours(23, 59, 59, 999);
        const existingEvents = await Calendar.getEventsAsync([calendarId], startDay, endDay);
        const duplicate = existingEvents.find(e => e.title === title && new Date(e.startDate).getTime() === new Date(appt.start).getTime());
        
        if (duplicate) {
          await Calendar.updateEventAsync(duplicate.id, eventDetails);
          updatedAppointments[i] = { ...appt, appleEventId: duplicate.id };
        } else {
          const newId = await Calendar.createEventAsync(calendarId, eventDetails);
          updatedAppointments[i] = { ...appt, appleEventId: newId };
        }
      }
    } catch (err) {
      console.error(`Failed to sync appointment ${appt.id}`, err);
    }
  }

  return updatedAppointments;
}
