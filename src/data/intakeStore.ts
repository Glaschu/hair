import { eq } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { clientToRow, appointmentToRow } from '../db/helpers';
import type { IntakePlan } from './intake';

/**
 * Committing an intake plan to the database.
 *
 * Deliberately NOT through React state. `runIntake` acknowledges a booking to
 * the service the moment `apply` resolves, so `apply` resolving has to mean the
 * rows are on disk — and a state setter resolves when React has been *asked* to
 * re-render, which is a different and much earlier moment. Going through
 * setState here would reintroduce exactly the window the ordering exists to
 * close: acknowledged to the service, not yet written, app killed.
 *
 * One transaction, so a batch is all-or-nothing. A half-applied batch would
 * leave appointments pointing at clients that do not exist.
 */
export function applyIntakePlan(plan: IntakePlan): void {
  if (!plan.newClients.length && !plan.appointments.length
      && !plan.clientUpdates.length && !plan.cancellations.length) return;

  db.transaction((tx) => {
    for (const c of plan.newClients) {
      tx.insert(schema.clients).values(clientToRow(c))
        // A client card may already exist from another device's sync. Her notes
        // on a regular must survive a booking arriving, so this never clobbers.
        .onConflictDoNothing()
        .run();
    }
    for (const a of plan.appointments) {
      tx.insert(schema.appointments).values(appointmentToRow(a))
        // The id is derived from the booking id, so a conflict here means this
        // exact booking is already in the diary — a re-delivery that raced.
        // Doing nothing is the correct answer: her edits to it stay hers.
        .onConflictDoNothing()
        .run();
    }
    // Gaps filled on her cards. The plan only ever carries fields that were
    // empty, so this cannot overwrite anything she typed.
    for (const { id, patch } of plan.clientUpdates) {
      tx.update(schema.clients).set(patch).where(eq(schema.clients.id, id)).run();
    }
    for (const { id, notes, updatedAt } of plan.cancellations) {
      tx.update(schema.appointments)
        .set({ status: 'cancelled', notes, updatedAt })
        .where(eq(schema.appointments.id, id))
        .run();
    }
  });
}
