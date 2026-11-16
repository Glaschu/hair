import { Appointment, Client, HairInfo } from './types';
import { IncomingBooking } from './bookingApi';
import { dateKey } from './daysOff';

/**
 * Taking a booking made on the web into her device.
 *
 * This is the last few feet of the whole booking story, and the place a booking
 * is most likely to vanish: it exists on the service, it does not yet exist in
 * her diary, and something has to move it across exactly once.
 *
 * THE ORDERING IS THE DESIGN. The local write happens first and the booking is
 * marked seen only after it has committed. That ordering is chosen so the
 * failure mode is a DUPLICATE DELIVERY, never a lost booking — the service
 * re-offers anything it has not been told about, and `planIntake` recognises
 * what it already has. The other order is faster and loses a client's Saturday
 * if the app is killed in the wrong second.
 *
 * So: at-least-once delivery, applied idempotently. `runIntake` sequences it;
 * the planning is pure so every awkward case can be built exactly.
 */

/**
 * The local id a booking always becomes.
 *
 * Derived from the service's id rather than generated, so a booking delivered
 * twice collides with itself instead of becoming two appointments. Dedupe is
 * then structural — it survives a restart, a restore from backup, and a lookup
 * that was not written yet.
 */
export function appointmentIdFor(bookingId: string): string {
  return `bk_${bookingId}`;
}

/**
 * The card a NEW client gets, named after the booking that brought them in.
 *
 * Derived for the same reason as the appointment's id. Her phone and iPad can
 * both pull a booking before either has told the service, and with a random id
 * each made its own card for the same person — two cards once iCloud merged
 * them, one of them empty. Derived, they make the same card, and the merge
 * folds them into one.
 */
export function clientIdFor(bookingId: string): string {
  return `cl_${bookingId}`;
}

/**
 * A phone number reduced to what actually identifies a person.
 *
 * "+44 7700 900123", "07700 900123" and "07700900123" are one client, and
 * creating a second record for a regular is the kind of small wrongness that
 * makes her stop trusting the diary.
 */
export function phoneKey(phone: string | undefined): string {
  const raw = (phone ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  // Written internationally: "+44…" or "0044…". Only then is a leading 44 a
  // country code — a number from elsewhere that happens to start 44 is left
  // alone rather than cut short into someone else's.
  const international = raw.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  let national: string;
  if (international) {
    // "+44 (0)7700…": the trunk 0 some people keep after the code goes too.
    national = digits.startsWith('44') ? digits.slice(2).replace(/^0/, '') : digits;
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else if (digits.startsWith('44') && digits.length === 12) {
    // "447700900123": a UK mobile with the + left off — 44 and ten digits.
    national = digits.slice(2);
  } else {
    national = digits;
  }
  // Too short to be a phone number is too short to match on: two clients who
  // both left it blank must never collapse into one person.
  return national.length >= 7 ? national : '';
}

const emailKey = (email: string | undefined) => (email ?? '').trim().toLowerCase();

const BLANK_HAIR: HairInfo = { type: '', length: '', natural: '' };

export interface IntakePlan {
  /** Clients who have never been in before, to create alongside the booking. */
  newClients: Client[];
  /**
   * Gaps filled on existing cards — a phone number or email the client gave
   * when booking that her card was missing. Never overwrites anything.
   */
  clientUpdates: { id: string; patch: Pick<Client, 'updatedAt'> & Partial<Pick<Client, 'phone' | 'email'>> }[];
  /** Appointments to write. Already deduped against what is in the diary. */
  appointments: Appointment[];
  /** Appointments the client has since cancelled online. */
  cancellations: { id: string; notes: string; updatedAt: number }[];
  /**
   * Bookings safe to mark seen — ONLY those now in the diary, or already there,
   * or that never needed to be. Anything still needing attention is
   * deliberately absent, so the service keeps offering it.
   */
  seen: string[];
  /** Envelopes that would not open. Never dropped, never marked seen. */
  needsAttention: IncomingBooking[];
}

const firstName = (name: string | undefined) =>
  (name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/**
 * Works out what a batch of incoming bookings means locally. Pure.
 *
 * WHO A BOOKING IS FOR, strongest evidence first:
 *   1. The link it came through. A link is made from a client's card, and the
 *      client it was sent to is sealed inside it — so a booking made through
 *      it lands on that card, whichever of her devices sent the link.
 *   2. Their phone number, in any format.
 *   3. Their email.
 *   4. Nobody yet: a new card.
 *
 * @param clientForRef turns a link's client reference back into a client id.
 */
export function planIntake(
  incoming: IncomingBooking[],
  {
    clients, appointments, deleted = [], clientForRef, now = Date.now(),
  }: {
    clients: readonly Client[];
    appointments: readonly Appointment[];
    /**
     * Ids she has deleted (the sync tombstones). A booking whose appointment
     * she deleted is handled, not new — without this, one whose
     * acknowledgement never landed came back every time she pulled. A deleted
     * client is never matched to.
     */
    deleted?: Iterable<string>;
    clientForRef?: (ref: string) => string | null;
    now?: number;
  },
): IntakePlan {
  const plan: IntakePlan = {
    newClients: [], clientUpdates: [], appointments: [], cancellations: [], seen: [], needsAttention: [],
  };

  const gone = new Set(deleted);
  const have = new Set([...appointments.map((a) => a.id), ...gone]);
  const apptById = new Map(appointments.map((a) => [a.id, a]));

  // Built once, then kept up to date as clients are minted or filled in: two
  // bookings from the same new client in one batch are one client, not two.
  const byId = new Map<string, Client>();
  const byPhone = new Map<string, Client>();
  const byEmail = new Map<string, Client>();
  const index = (c: Client) => {
    byId.set(c.id, c);
    const p = phoneKey(c.phone);
    if (p && !byPhone.has(p)) byPhone.set(p, c);
    const e = emailKey(c.email);
    if (e && !byEmail.has(e)) byEmail.set(e, c);
  };
  clients.filter((c) => !gone.has(c.id)).forEach(index);
  const minted = new Set<string>();

  for (const booking of incoming) {
    const id = appointmentIdFor(booking.id);
    const status = booking.status ?? 'confirmed';

    // Status comes before everything else. A booking cancelled before she
    // pulled used to arrive as a live appointment — a no-show she would wait
    // for, in an hour she could have resold.
    if (status === 'cancelled') {
      const existing = apptById.get(id);
      if (existing?.status === 'upcoming') {
        plan.cancellations.push({
          id,
          notes: [existing.notes?.trim(), 'Cancelled online by the client.'].filter(Boolean).join('\n'),
          updatedAt: now,
        });
      }
      plan.seen.push(booking.id);
      continue;
    }
    // Still at Stripe: deliberately NOT acknowledged, so it comes back once
    // the payment confirms — or does not.
    if (status === 'pending_payment') continue;
    // Expired, or lost its hour while paying (and is being refunded): there is
    // nothing for the diary, and nothing to wait for.
    if (status !== 'confirmed') {
      plan.seen.push(booking.id);
      continue;
    }

    // Already in the diary — or deliberately deleted from it: this is a
    // re-delivery because marking seen did not land last time. Confirm it, do
    // not write it twice, and never bring back what she removed. Checked
    // before the envelope, so an already-imported booking is never flagged as
    // unreadable.
    if (have.has(id)) {
      plan.seen.push(booking.id);
      continue;
    }

    // An envelope that will not open is a real booking whose details are
    // unreadable — most likely her key was restored from a different backup.
    // Dropping it loses the appointment; marking it seen loses it for good.
    // It stays in the inbox so that recovering the right key still rescues it.
    if (!booking.details) {
      plan.needsAttention.push(booking);
      continue;
    }

    const { name, phone, email, note } = booking.details;
    // A booking with an unreadable creation time must not take the whole batch
    // down with it — one bad document used to fail every pull.
    const createdAt = Number.isFinite(booking.createdAt) ? booking.createdAt : now;
    const p = phoneKey(phone);
    const e = emailKey(email);

    const linkedId = booking.clientRef && clientForRef ? clientForRef(booking.clientRef) : null;
    const linked = linkedId ? byId.get(linkedId) ?? null : null;
    let client = linked || (p && byPhone.get(p)) || (e && byEmail.get(e)) || null;

    // A link can be forwarded — someone booking for a partner or a friend. The
    // booking still belongs on the card the link was sent from, but she has to
    // be able to see that someone else is coming.
    const bookedAsSomeoneElse = !!linked && firstName(name) !== '' && firstName(name) !== firstName(linked.name);

    if (!client) {
      client = {
        id: clientIdFor(booking.id),
        name: name.trim() || 'New client',
        tone: '',
        phone: phone ?? '',
        email: email ?? '',
        since: dateKey(new Date(createdAt)),
        hair: { ...BLANK_HAIR },
        formula: '',
        allergies: '',
        notes: '',
        updatedAt: createdAt,
      };
      plan.newClients.push(client);
      minted.add(client.id);
      index(client);
    } else if (!minted.has(client.id) && !bookedAsSomeoneElse) {
      // Fill gaps on her card from what they typed — a number for a client she
      // only knew from Instagram — never overwriting anything she has. Not
      // when someone else booked through the link: that would put a stranger's
      // number on the card.
      const patch: IntakePlan['clientUpdates'][number]['patch'] = { updatedAt: now };
      if (!client.phone?.trim() && phone?.trim()) patch.phone = phone.trim();
      if (!client.email?.trim() && email?.trim()) patch.email = email.trim();
      if (patch.phone || patch.email) {
        const prior = plan.clientUpdates.find((u) => u.id === client!.id);
        if (prior) Object.assign(prior.patch, patch);
        else plan.clientUpdates.push({ id: client.id, patch });
        client = { ...client, ...patch };
        index(client);
      }
    }

    const notes = [
      bookedAsSomeoneElse ? `Booked online as ${name.trim()}${phone?.trim() ? ` (${phone.trim()})` : ''}.` : '',
      // What they typed when booking is the first thing she wants chair-side.
      note?.trim() ?? '',
    ].filter(Boolean).join('\n');

    plan.appointments.push({
      id,
      clientId: client.id,
      start: booking.startsAt,
      end: booking.endsAt,
      service: booking.serviceName,
      status: 'upcoming',
      price: booking.priceMinor / 100,
      products: [],
      notes: notes || undefined,
      updatedAt: createdAt,
    });
    have.add(id);
    plan.seen.push(booking.id);
  }

  return plan;
}

export interface IntakeReport {
  added: number;
  /** Bookings that arrived again because marking seen did not land last time. */
  redelivered: number;
  newClients: number;
  needsAttention: IncomingBooking[];
  /** Ids written locally that the service was not told about. Harmless: they come back. */
  unacknowledged: string[];
  /** Appointments marked cancelled because the client cancelled online. */
  cancelled: number;
  /** Existing cards that gained a phone number or email from a booking. */
  cardsUpdated: number;
  /**
   * The subset that can NEVER be acknowledged as things stand — a booking
   * written before bookings carried versions. Still harmless (it is recognised
   * each time), but it will not clear on its own, so it is reported by name
   * rather than folded in with transient failures.
   */
  stuck: string[];
}

/**
 * Applies a plan in the one order that cannot lose a booking.
 *
 * `apply` must not resolve until the writes are durable — everything after this
 * point assumes the diary already has them.
 */
export async function runIntake(
  incoming: IncomingBooking[],
  {
    clients, appointments, apply, markSeen, deleted, clientForRef, now,
  }: {
    clients: readonly Client[];
    appointments: readonly Appointment[];
    apply: (plan: IntakePlan) => Promise<void>;
    markSeen: (bookingId: string) => Promise<unknown>;
    deleted?: Iterable<string>;
    clientForRef?: (ref: string) => string | null;
    now?: number;
  },
): Promise<IntakeReport> {
  const plan = planIntake(incoming, { clients, appointments, deleted, clientForRef, now });

  if (plan.appointments.length || plan.newClients.length
      || plan.clientUpdates.length || plan.cancellations.length) {
    // Deliberately not caught. If the diary cannot be written, nothing is
    // acknowledged, and the whole batch is offered again next time.
    await apply(plan);
  }

  const unacknowledged: string[] = [];
  const stuck: string[] = [];
  for (const id of plan.seen) {
    try {
      await markSeen(id);
    } catch (e) {
      if ((e as Error)?.name === 'UnversionedBookingError') stuck.push(id);
      // The booking is already safe in the diary; the service just has not been
      // told. It will re-offer it, and the id it becomes is already taken, so
      // the re-offer is recognised rather than duplicated. Nothing to undo.
      unacknowledged.push(id);
    }
  }

  const redelivered = incoming.filter((b) => (b.status ?? 'confirmed') === 'confirmed').length
    - plan.appointments.length - plan.needsAttention.length;
  return {
    added: plan.appointments.length,
    redelivered,
    newClients: plan.newClients.length,
    cancelled: plan.cancellations.length,
    cardsUpdated: plan.clientUpdates.length,
    needsAttention: plan.needsAttention,
    unacknowledged,
    stuck,
  };
}
