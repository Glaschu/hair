import { enqueue, flush, pending, withdraw, webBookingIdOf, type QueueStore } from '../webCancels';
import { appointmentIdFor } from '../intake';

/**
 * Her cancelling a web booking has to reach the service — to give the hour
 * back and refund a deposit — even if she cancels with no signal at all.
 */

const memory = (initial: string | null = null): QueueStore & { value: string | null } => {
  const store = {
    value: initial,
    read: () => store.value,
    write: (v: string) => { store.value = v; },
  };
  return store;
};

const item = (bookingId = 'b1') => ({ bookingId, refund: 'full' as const, cancelledAt: 1 });

it('is written down before anything is sent', () => {
  const store = memory();
  enqueue(store, item());
  expect(pending(store)).toEqual([item()]);
});

it('goes once the service has it', async () => {
  const store = memory();
  enqueue(store, item());
  expect(await flush(store, async () => 'done')).toEqual({ sent: 1, waiting: 0 });
  expect(pending(store)).toEqual([]);
});

it('stays, and goes again later, when there is no signal', async () => {
  const store = memory();
  enqueue(store, item());
  expect(await flush(store, async () => { throw new Error('offline'); })).toEqual({ sent: 0, waiting: 1 });
  expect(await flush(store, async () => 'done')).toEqual({ sent: 1, waiting: 0 });
});

it('a failure part-way leaves exactly the unsent ones', async () => {
  const store = memory();
  enqueue(store, item('b1'));
  enqueue(store, item('b2'));
  await flush(store, async (i) => (i.bookingId === 'b1' ? 'done' : 'retry'));
  expect(pending(store).map((p) => p.bookingId)).toEqual(['b2']);
});

it('cancelling the same booking twice is one request', () => {
  const store = memory();
  enqueue(store, item());
  enqueue(store, { ...item(), refund: 'policy' });
  expect(pending(store)).toEqual([{ ...item(), refund: 'policy' }]);
});

it('a queue that will not read is started afresh rather than stopping her cancelling', () => {
  expect(pending(memory('{not json'))).toEqual([]);
});

it('knows a web booking from one made in the app', () => {
  expect(webBookingIdOf(appointmentIdFor('abc123'))).toBe('abc123');
  expect(webBookingIdOf('a7f3')).toBeNull();
});

it('undo before it was sent takes it back, so the service never cancels or refunds', async () => {
  // She cancelled with no signal, then changed her mind. Without this the next
  // pull would still cancel the booking and refund the deposit.
  const store = memory();
  enqueue(store, item('b1'));
  expect(withdraw(store, 'b1')).toBe('withdrawn');
  const sent: string[] = [];
  await flush(store, async (i) => { sent.push(i.bookingId); return 'done'; });
  expect(sent).toEqual([]);
});

it('undo after it was sent says so — the service has already acted', async () => {
  const store = memory();
  const delivered = memory();
  enqueue(store, item('b1'));
  await flush(store, async () => 'done', delivered);
  expect(withdraw(store, 'b1', delivered)).toBe('sent');
});

it('undo of one this device never sent does not claim the service acted', () => {
  // Cancelled while the device was not linked, or by the client from their
  // link: nothing here ever reached the service, so "your deposit is being
  // refunded" would be a promise nobody is keeping.
  expect(withdraw(memory(), 'b1', memory())).toBe('unknown');
});

it('undo while the request is already on its way counts as sent, not taken back', async () => {
  // On a slow connection she taps Undo mid-request. The service will still
  // cancel and refund, so she must be warned — never told it was withdrawn.
  const store = memory();
  enqueue(store, item('b1'));
  let duringSend: string | null = null;
  await flush(store, async () => { duringSend = withdraw(store, 'b1'); return 'done'; });
  expect(duringSend).toBe('sent');
});

it('a pull and a cancel sending at once never let undo say "taken back" mid-send', async () => {
  // The pull's send fails; the cancel's own flush then sends it again. With
  // both running side by side, the pull finishing cleared the in-flight mark
  // while the second request was still on its way.
  const store = memory();
  enqueue(store, item('b1'));
  let release!: () => void;
  let started!: () => void;
  const slow = new Promise<void>((r) => { release = r; });
  const begun = new Promise<void>((r) => { started = r; });
  const seen: string[] = [];
  const pull = flush(store, async () => 'retry');
  const cancel = flush(store, async () => {
    started();
    await slow;
    return 'done';
  });
  await pull;
  await begun;
  seen.push(withdraw(store, 'b1'));
  release();
  await cancel;
  expect(seen).toEqual(['sent']);
});

it('one withdrawn while an earlier one was sending is not sent', async () => {
  const store = memory();
  enqueue(store, item('b1'));
  enqueue(store, item('b2'));
  const sent: string[] = [];
  await flush(store, async (i) => { sent.push(i.bookingId); withdraw(store, 'b2'); return 'done'; });
  expect(sent).toEqual(['b1']);
});
