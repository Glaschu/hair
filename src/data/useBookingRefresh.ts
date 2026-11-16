import { useEffect, useState } from 'react';
import { useApp } from './AppContext';
import { useDialog } from './DialogContext';
import { describeFailure } from './serviceErrors';

/**
 * Pull down to bring web bookings in — on the phone's Today and the iPad's.
 *
 * The iPad had no way to do this at all: it only ever saw web bookings second
 * hand, through iCloud from the phone. One hook, so both screens pull the same
 * way: her waiting cancellations go out, new bookings and client cancellations
 * come in, and any money that needs her is fetched.
 *
 * Safe to pull repeatedly — a booking already here is recognised rather than
 * added twice.
 */
export function useBookingRefresh() {
  const { importBookings, refreshMoneyAlerts, backend } = useApp();
  const dialog = useDialog();
  const [refreshing, setRefreshing] = useState(false);

  // Money that needs her is worth knowing about without being asked: a
  // dispute has a deadline. Fetched when the screen opens; failures stay quiet
  // here, because the pull says so out loud.
  useEffect(() => {
    if (backend.has('deposits')) refreshMoneyAlerts().catch(() => {});
  }, [backend]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const report = await importBookings();
      if (report?.needsAttention.length) {
        // Never silent. These are real bookings whose details will not open —
        // she has to know someone is coming even when the name will not read.
        dialog.alert({
          title: 'Some bookings need attention',
          message: `${report.needsAttention.length} booking${report.needsAttention.length > 1 ? 's' : ''} arrived that this device cannot open. They are still on the booking service.`,
        });
      }
      await refreshMoneyAlerts().catch(() => {});
    } catch (e) {
      // A failed pull has lost nothing: anything not acknowledged is offered
      // again next time. But "check your connection" is only the right advice
      // when it IS the connection — no longer linked, signed out, or the
      // service in trouble each need her to do something else.
      dialog.alert({
        title: 'Could not check for bookings',
        message: describeFailure(e, 'Check your connection and pull down again.').message,
      });
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, onRefresh };
}
