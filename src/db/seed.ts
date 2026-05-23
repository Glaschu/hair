import { db } from './index';
import * as schema from './schema';
import { CLIENTS, PRODUCTS, WEEK_APPOINTMENTS, SERVICES, DEFAULT_SCHEDULE } from '../data/mockData';
import { clientToRow, productToRow, appointmentToRow, serviceToRow } from './helpers';

export function seedIfEmpty() {
  const existing = db.select({ id: schema.clients.id }).from(schema.clients).limit(1).all();
  if (existing.length > 0) return;

  db.transaction((tx) => {
    CLIENTS.forEach(c => {
      tx.insert(schema.clients).values(clientToRow(c)).run();
      (c.photos ?? []).forEach(p =>
        tx.insert(schema.clientPhotos).values({ ...p, clientId: c.id }).run()
      );
    });

    PRODUCTS.forEach(p => tx.insert(schema.products).values(productToRow(p)).run());

    WEEK_APPOINTMENTS.forEach(a => {
      tx.insert(schema.appointments).values(appointmentToRow(a)).run();
      a.products.forEach(ap =>
        tx.insert(schema.appointmentProducts).values({ appointmentId: a.id, ...ap }).run()
      );
    });

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
  });
}
