export interface HairInfo {
  type: string;
  length: string;
  natural: string;
}

export interface ClientPhoto {
  id: string;
  date: string;
  url: string;
  label: string;
  appointmentId?: string;
}

export interface Client {
  id: string;
  name: string;
  tone: string;
  phone: string;
  email: string;
  instagram?: string;
  since: string;
  hair: HairInfo;
  formula: string;
  allergies: string;
  notes: string;
  vip?: boolean;
  photo?: string;
  photos?: ClientPhoto[];
  updatedAt?: number;
}

export type ProductStatus = 'ok' | 'low' | 'out';

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  size: number;
  unit: string;
  stock: number;
  reorder: number;
  perUse: number;
  cost: number;
  status: ProductStatus;
  barcode?: string;
  hasVat?: boolean;
  baseCost?: number;
  updatedAt?: number;
}

export interface ApptProduct {
  productId: string;
  amount: number;
}

export type AppointmentStatus = 'upcoming' | 'completed' | 'cancelled' | 'no-show';

export interface Appointment {
  id: string;
  clientId: string;
  start: string;
  end: string;
  service: string;
  status: AppointmentStatus;
  price: number;
  products: ApptProduct[];
  notes?: string;
  formula?: string;
  paid?: boolean;
  appleEventId?: string;
  updatedAt?: number;
}

export interface Service {
  id: string;
  name: string;
  duration: number;
  price: number;
  defaults: string[];
  recommended: string[];
  updatedAt?: number;
}

export interface ScheduleDay {
  open: boolean;
  start: string;
  end: string;
}

export type Schedule = Record<number, ScheduleDay>;

export interface ExportPayload {
  version: 1;
  exported: string;
  clients: Client[];
  products: Product[];
  appointments: Appointment[];
  services: Service[];
  schedule: Schedule;
  tombstones?: Record<string, number>;
}
