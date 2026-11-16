import * as Haptics from 'expo-haptics';
import { Appointment } from './types';
import { useApp } from './AppContext';
import { notifyLowStock } from './notifications';
import { deductUsage, restoreUsage } from './visits';

/**
 * The one place appointment status transitions happen. Stock deduction,
 * low-stock notifications, and haptics stay consistent no matter which
 * screen completes a visit.
 */
export function useVisitActions() {
  const { products, setProducts, setAppointments } = useApp();

  const complete = (appt: Appointment, opts?: { paid?: boolean }) => {
    if (appt.status !== 'upcoming') return;
    // Alerts fire from the current snapshot; the setter recomputes from prev
    // so batched updates can't double-deduct.
    const { alerts } = deductUsage(products, appt.products);
    alerts.forEach((a) => notifyLowStock(a.name, a.isOut));
    setProducts((prev) => deductUsage(prev, appt.products).products);
    setAppointments((prev) =>
      prev.map((a) => (a.id === appt.id ? { ...a, status: 'completed', paid: opts?.paid ?? true } : a)),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  /** Marks upcoming again; restores stock only if the visit was completed. */
  const undoComplete = (appt: Appointment) => {
    if (appt.status === 'completed') {
      setProducts((prev) => restoreUsage(prev, appt.products));
    }
    setAppointments((prev) =>
      prev.map((a) => (a.id === appt.id ? { ...a, status: 'upcoming' } : a)),
    );
  };

  const markNoShow = (appt: Appointment) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === appt.id ? { ...a, status: 'no-show' } : a)),
    );
  };

  const markCancelled = (appt: Appointment) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === appt.id ? { ...a, status: 'cancelled' } : a)),
    );
  };

  return { complete, undoComplete, markNoShow, markCancelled };
}
