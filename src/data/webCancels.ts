/**
 * Cancellations of web bookings, on their way to the service.
 *
 * When she cancels a booking that came in online, the service has to hear
 * about it — to give the hour back and, where a deposit was taken, to refund
 * it. She may well cancel with no signal (in the salon basement, on a train),
 * so the request is written down FIRST, on this device, and only then sent;
 * anything not yet acknowledged is sent again on the next pull. The same
 * at-least-once rule as the inbox, and safe for the same reason: cancelling a
 * cancelled booking is a no-op on the service.
 *
 * Kept per device and out of the iCloud payload: it is a to-do for this
 * device's network connection, not a fact about her diary.
 */

export interface PendingWebCancel {
  bookingId: string;
  /** 'full' — she is calling it off; 'policy' — the client asked. */
  refund: 'full' | 'policy';
  /** When she pressed cancel — the notice a refund is worked out from. */
  cancelledAt: number;
}

/** Where the queue is kept. The app's is the settings table; tests use memory. */
export interface QueueStore {
  read(): string | null;
  write(value: string): void;
}

export function pending(store: QueueStore): PendingWebCancel[] {
  try {
    const parsed = JSON.parse(store.read() ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p?.bookingId === 'string') : [];
  } catch {
    // A queue that will not parse is unreadable, not empty — but an exception
    // here would stop her cancelling anything at all. Start again; the
    // diary itself still says cancelled.
    return [];
  }
}

/** Written down before anything is sent. A second cancel of the same booking replaces the first. */
export function enqueue(store: QueueStore, item: PendingWebCancel): void {
  const rest = pending(store).filter((p) => p.bookingId !== item.bookingId);
  store.write(JSON.stringify([...rest, item]));
}

/** Cancellations being sent right now — past the point of taking back. */
const inFlight = new Set<string>();

/** How many acknowledged cancellations are remembered — enough for any undo she might reach for. */
const SENT_KEPT = 50;

function sentIds(sent: QueueStore | undefined): string[] {
  if (!sent) return [];
  try {
    const parsed = JSON.parse(sent.read() ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function noteSent(sent: QueueStore | undefined, bookingId: string): void {
  if (!sent) return;
  const rest = sentIds(sent).filter((id) => id !== bookingId);
  sent.write(JSON.stringify([...rest, bookingId].slice(-SENT_KEPT)));
}

/**
 * What an undo found:
 *   withdrawn — still waiting here, now taken back: the service never hears
 *   sent      — on its way or acknowledged: the service has cancelled it
 *   unknown   — never queued on this device: cancelled before it was linked,
 *               by the client online, or from her other device
 */
export type Withdrawal = 'withdrawn' | 'sent' | 'unknown';

/** Takes back a cancellation that has not been sent yet — she pressed undo before the service heard. */
export function withdraw(store: QueueStore, bookingId: string, sent?: QueueStore): Withdrawal {
  // Already on its way: the service may act on it whatever is done here, so it
  // counts as sent — telling her "taken back" while the refund goes out anyway
  // is the one answer that must never be given.
  if (inFlight.has(bookingId)) return 'sent';
  const all = pending(store);
  const rest = all.filter((p) => p.bookingId !== bookingId);
  if (rest.length !== all.length) {
    store.write(JSON.stringify(rest));
    return 'withdrawn';
  }
  // Not waiting here. Only a cancellation this device actually delivered may
  // be described as done — "your deposit is being refunded" said about one
  // that never reached the service is a promise nobody is keeping.
  return sentIds(sent).includes(bookingId) ? 'sent' : 'unknown';
}

/**
 * Flushes run one after another, never side by side. Two at once — a pull and
 * a cancel — would share `inFlight`, and the first to finish would clear the
 * marker while the second was still sending: Undo would then say "taken back"
 * about a cancellation the service was acting on.
 */
let running: Promise<unknown> = Promise.resolve();

/**
 * Sends everything waiting. Each item is removed only once the service has it,
 * so a failure part-way leaves exactly the unsent ones behind. `sent`, where
 * given, remembers what was delivered, so Undo can say so truthfully.
 */
export function flush(
  store: QueueStore,
  send: (item: PendingWebCancel) => Promise<'done' | 'retry'>,
  sent?: QueueStore,
): Promise<{ sent: number; waiting: number }> {
  const run = running.then(() => flushNow(store, send, sent));
  running = run.catch(() => {});
  return run;
}

async function flushNow(
  store: QueueStore,
  send: (item: PendingWebCancel) => Promise<'done' | 'retry'>,
  sentStore: QueueStore | undefined,
): Promise<{ sent: number; waiting: number }> {
  let sent = 0;
  for (const item of pending(store)) {
    // Withdrawn while an earlier one was being sent: it must not go.
    if (!pending(store).some((p) => p.bookingId === item.bookingId)) continue;
    inFlight.add(item.bookingId);
    try {
      const outcome = await send(item).catch(() => 'retry' as const);
      if (outcome === 'done') {
        sent++;
        // Noted as sent before it leaves the queue, so there is no moment at
        // which an undo finds it in neither.
        noteSent(sentStore, item.bookingId);
        store.write(JSON.stringify(pending(store).filter((p) => p.bookingId !== item.bookingId)));
      }
    } finally {
      inFlight.delete(item.bookingId);
    }
  }
  return { sent, waiting: pending(store).length };
}

/** A web booking's id on the service, from the appointment it became — or null if it was made in the app. */
export function webBookingIdOf(appointmentId: string): string | null {
  return appointmentId.startsWith('bk_') ? appointmentId.slice(3) : null;
}
