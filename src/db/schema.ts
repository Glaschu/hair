import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const clients = sqliteTable('clients', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  tone:        text('tone').notNull().default('#C49A7A'),
  phone:       text('phone').notNull().default(''),
  email:       text('email').notNull().default(''),
  instagram:   text('instagram'),
  since:       text('since').notNull(),
  visits:      integer('visits').notNull().default(0),
  spend:       real('spend').notNull().default(0),
  hairType:    text('hair_type').notNull().default('Wavy'),
  hairLength:  text('hair_length').notNull().default('Mid-length'),
  hairNatural: text('hair_natural').notNull().default('Dark brown'),
  formula:     text('formula').notNull().default(''),
  allergies:   text('allergies').notNull().default('None on file'),
  notes:       text('notes').notNull().default(''),
  vip:         integer('vip', { mode: 'boolean' }).notNull().default(false),
  photo:       text('photo'),
  updatedAt:   integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const clientPhotos = sqliteTable('client_photos', {
  id:       text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  appointmentId: text('appointment_id'),
  date:     text('date').notNull(),
  url:      text('url').notNull(),
  label:    text('label').notNull().default(''),
  updatedAt: integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const products = sqliteTable('products', {
  id:       text('id').primaryKey(),
  name:     text('name').notNull(),
  brand:    text('brand').notNull().default(''),
  category: text('category').notNull().default(''),
  size:     real('size').notNull().default(0),
  unit:     text('unit').notNull().default('mL'),
  stock:    real('stock').notNull().default(0),
  reorder:  real('reorder').notNull().default(0),
  perUse:   real('per_use').notNull().default(0),
  cost:     real('cost').notNull().default(0),
  status:   text('status', { enum: ['ok', 'low', 'out'] }).notNull().default('ok'),
  barcode:  text('barcode'),
  hasVat:   integer('has_vat', { mode: 'boolean' }).notNull().default(false),
  baseCost: real('base_cost'),
  updatedAt: integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const appointments = sqliteTable('appointments', {
  id:           text('id').primaryKey(),
  clientId:     text('client_id').notNull(),
  start:        text('start').notNull(),
  end:          text('end').notNull(),
  service:      text('service').notNull().default(''),
  status:       text('status', { enum: ['upcoming', 'completed', 'cancelled', 'no-show'] }).notNull().default('upcoming'),
  price:        real('price').notNull().default(0),
  notes:        text('notes'),
  formula:      text('formula'),
  paid:         integer('paid', { mode: 'boolean' }).notNull().default(false),
  appleEventId: text('apple_event_id'),
  updatedAt:    integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const appointmentProducts = sqliteTable('appointment_products', {
  appointmentId: text('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  productId:     text('product_id').notNull(),
  amount:        real('amount').notNull().default(0),
  updatedAt:     integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const services = sqliteTable('services', {
  id:       text('id').primaryKey(),
  name:     text('name').notNull(),
  duration: integer('duration').notNull().default(60),
  price:    real('price').notNull().default(0),
  updatedAt: integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const serviceProducts = sqliteTable('service_products', {
  serviceId: text('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  type:      text('type', { enum: ['default', 'recommended'] }).notNull(),
  updatedAt: integer('updated_at').$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now()),
});

export const schedule = sqliteTable('schedule', {
  day:   integer('day').primaryKey(),
  open:  integer('open', { mode: 'boolean' }).notNull().default(true),
  start: text('start').notNull().default('09:00'),
  end:   text('end').notNull().default('18:00'),
});

export const settings = sqliteTable('settings', {
  key:   text('key').primaryKey(),
  value: text('value').notNull(),
});
