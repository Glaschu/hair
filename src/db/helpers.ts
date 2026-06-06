import { Client, Product, Appointment, Service, Schedule } from '../data/types';
import * as schema from './schema';

// ---- Clients ----
export function rowToClient(
  row: typeof schema.clients.$inferSelect,
  photos: typeof schema.clientPhotos.$inferSelect[],
): Client {
  return {
    id: row.id, name: row.name, tone: row.tone, phone: row.phone,
    email: row.email, instagram: row.instagram ?? undefined, since: row.since,
    hair: { type: row.hairType, length: row.hairLength, natural: row.hairNatural },
    formula: row.formula, allergies: row.allergies, notes: row.notes,
    vip: row.vip ?? false, photo: row.photo ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    photos: photos.map(p => ({ id: p.id, date: p.date, url: p.url, label: p.label, appointmentId: p.appointmentId ?? undefined })),
  };
}

export function clientToRow(c: Client): typeof schema.clients.$inferInsert {
  return {
    id: c.id, name: c.name, tone: c.tone, phone: c.phone, email: c.email,
    instagram: c.instagram ?? null,
    since: c.since, visits: 0, spend: 0,
    hairType: c.hair.type, hairLength: c.hair.length, hairNatural: c.hair.natural,
    formula: c.formula, allergies: c.allergies, notes: c.notes,
    vip: c.vip ?? false, photo: c.photo ?? null,
    updatedAt: c.updatedAt,
  };
}

// ---- Products ----
export function rowToProduct(row: typeof schema.products.$inferSelect): Product {
  return {
    id: row.id, name: row.name, brand: row.brand, category: row.category,
    size: row.size, unit: row.unit, stock: row.stock, reorder: row.reorder,
    perUse: row.perUse, cost: row.cost, status: row.status as Product['status'],
    barcode: row.barcode ?? undefined,
    hasVat: row.hasVat ?? false,
    baseCost: row.baseCost ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  };
}

export function productToRow(p: Product): typeof schema.products.$inferInsert {
  return {
    id: p.id, name: p.name, brand: p.brand, category: p.category,
    size: p.size, unit: p.unit, stock: p.stock, reorder: p.reorder,
    perUse: p.perUse, cost: p.cost, status: p.status, barcode: p.barcode ?? null,
    hasVat: p.hasVat ?? false, baseCost: p.baseCost ?? null,
    updatedAt: p.updatedAt,
  };
}

// ---- Appointments ----
export function rowToAppointment(
  row: typeof schema.appointments.$inferSelect,
  apptProducts: typeof schema.appointmentProducts.$inferSelect[],
): Appointment {
  return {
    id: row.id, clientId: row.clientId, start: row.start, end: row.end,
    service: row.service, status: row.status as Appointment['status'],
    price: row.price, notes: row.notes ?? undefined, formula: row.formula ?? undefined, paid: row.paid,
    appleEventId: row.appleEventId ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    products: apptProducts
      .filter(p => p.appointmentId === row.id)
      .map(p => ({ productId: p.productId, amount: p.amount })),
  };
}

export function appointmentToRow(a: Appointment): typeof schema.appointments.$inferInsert {
  return {
    id: a.id, clientId: a.clientId, start: a.start, end: a.end,
    service: a.service, status: a.status, price: a.price, notes: a.notes ?? null, formula: a.formula ?? null,
    paid: a.paid ?? false,
    appleEventId: a.appleEventId ?? null,
    updatedAt: a.updatedAt,
  };
}

// ---- Services ----
export function rowToService(
  row: typeof schema.services.$inferSelect,
  svcProducts: typeof schema.serviceProducts.$inferSelect[],
): Service {
  return {
    id: row.id, name: row.name, duration: row.duration, price: row.price,
    defaults:    svcProducts.filter(p => p.serviceId === row.id && p.type === 'default').map(p => p.productId),
    recommended: svcProducts.filter(p => p.serviceId === row.id && p.type === 'recommended').map(p => p.productId),
    updatedAt: row.updatedAt ?? undefined,
  };
}

export function serviceToRow(s: Service): typeof schema.services.$inferInsert {
  return { id: s.id, name: s.name, duration: s.duration, price: s.price, updatedAt: s.updatedAt };
}

// ---- Schedule ----
export function rowsToSchedule(rows: typeof schema.schedule.$inferSelect[]): Schedule {
  const result: Schedule = {};
  rows.forEach(r => { result[r.day] = { open: r.open, start: r.start, end: r.end }; });
  return result;
}
