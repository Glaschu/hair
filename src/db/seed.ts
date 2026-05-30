import { db } from './index';
import * as schema from './schema';
import { CLIENTS, PRODUCTS, WEEK_APPOINTMENTS, SERVICES, DEFAULT_SCHEDULE } from '../data/mockData';
import { clientToRow, productToRow, appointmentToRow, serviceToRow } from './helpers';

import { eq } from 'drizzle-orm';

export function seedIfEmpty() {
  const seeded = db.select().from(schema.settings).where(eq(schema.settings.key, 'seeded')).limit(1).all();
  if (seeded.length > 0 && seeded[0].value === 'true') return;

  const existing = db.select({ id: schema.clients.id }).from(schema.clients).limit(1).all();
  if (existing.length > 0) {
    db.insert(schema.settings).values({ key: 'seeded', value: 'true' }).onConflictDoNothing().run();
    return;
  }

  db.transaction((tx) => {
    SERVICES.forEach(s => {
      tx.insert(schema.services).values(serviceToRow(s)).run();
      s.defaults.forEach(pid =>
        tx.insert(schema.serviceProducts).values({ serviceId: s.id, productId: pid, type: 'default' }).run()
      );
      s.recommended.forEach(pid =>
        tx.insert(schema.serviceProducts).values({ serviceId: s.id, productId: pid, type: 'recommended' }).run()
      );
    });

    Object.entries(DEFAULT_SCHEDULE).forEach(([day, info]) =>
      tx.insert(schema.schedule).values({ day: Number(day), ...info })
        .onConflictDoUpdate({ target: schema.schedule.day, set: info }).run()
    );

    tx.insert(schema.settings).values({ key: 'seeded', value: 'true' }).onConflictDoNothing().run();
  });
}
