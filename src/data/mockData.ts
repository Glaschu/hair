import { Client, Product, Appointment, Service, Schedule } from './types';

const TODAY = new Date();

const isoOffset = (days = 0, hour = 9, min = 0): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

export const CLIENTS: Client[] = [
  {
    id: 'c1', name: 'Margot Lebreton', tone: '#C4967A',
    phone: '+44 7700 901 224', email: 'margot.l@hey.com',
    since: 'Mar 2022',
    hair: { type: 'Fine, wavy', length: 'Mid-back', natural: 'Level 5 cool brown' },
    formula: '6N + 6.34 (1:1) + 20 vol, 35 min',
    allergies: 'PPD sensitive — patch test 48h prior',
    notes: 'Prefers neutral tones, avoids warm gold. Likes head massage at basin.',
  },
  {
    id: 'c2', name: 'Saoirse Whelan', tone: '#C49A5C',
    phone: '+44 7700 904 112', email: 'saoirse@whelan.co',
    since: 'Sep 2023',
    hair: { type: 'Coarse, curly (3B)', length: 'Shoulder', natural: 'Level 4 warm brown' },
    formula: 'Balayage: 9% lift, lived-in. Gloss: 9.13 + 6 vol, 15 min',
    allergies: 'None on file',
    notes: 'Brings own reference photos. Books 90-min slots min.',
  },
  {
    id: 'c3', name: 'Theo Ashworth', tone: '#8B6550',
    phone: '+44 7700 902 778', email: 't.ash@studio.io',
    since: 'Jan 2024',
    hair: { type: 'Medium, straight', length: 'Short', natural: 'Level 3 neutral' },
    formula: 'Scissor cut, no clipper. Texturise crown.',
    allergies: 'None on file',
    notes: 'Likes the work + chat balance. Black coffee, no milk.',
  },
  {
    id: 'c4', name: 'Imani Okonkwo', tone: '#6B4A3C',
    phone: '+44 7700 906 441', email: 'imani.o@design.studio',
    since: 'Jun 2024',
    hair: { type: 'Coarse, coily (4A)', length: 'Shoulder', natural: 'Level 2 black' },
    formula: 'Protective styles only. Deep condition every visit.',
    allergies: 'Avoid sulfates',
    notes: 'Photographer — flexible bookings. Loves the new bond mask.',
  },
  {
    id: 'c5', name: 'Beatrice Kallio', tone: '#D4C090',
    phone: '+44 7700 909 003', email: 'bea.k@local.uk',
    since: 'Nov 2021',
    hair: { type: 'Fine, straight', length: 'Long', natural: 'Level 8 cool blonde' },
    formula: 'Toner: 10.1 + 6 vol, 10 min. Brightening shampoo monthly.',
    allergies: 'None on file',
    notes: 'VIP — block-books 6 months ahead.',
    vip: true,
  },
  {
    id: 'c6', name: 'Cassia Pereira', tone: '#B89470',
    phone: '+44 7700 901 887', email: 'cassia.p@mail.co',
    since: 'Apr 2025',
    hair: { type: 'Medium, wavy', length: 'Mid-back', natural: 'Level 6 warm brown' },
    formula: 'Glossy refresh: 7.34 + 6 vol',
    allergies: 'None on file',
    notes: 'New client — building rapport. Tends to run 10 min late.',
  },
  {
    id: 'c7', name: 'Yusuf Demir', tone: '#7A5E48',
    phone: '+44 7700 905 224', email: 'yusuf.d@arch.co',
    since: 'Aug 2024',
    hair: { type: 'Coarse, straight', length: 'Short', natural: 'Level 2 black' },
    formula: 'Skin fade 0.5 → 4. Beard trim.',
    allergies: 'None on file',
    notes: 'Comes every 3 weeks — Friday 5pm regular.',
  },
  {
    id: 'c8', name: 'Noor Haidari', tone: '#A08060',
    phone: '+44 7700 903 919', email: 'noor.h@studio.co',
    since: 'Feb 2025',
    hair: { type: 'Medium, wavy', length: 'Shoulder', natural: 'Level 4 neutral brown' },
    formula: 'Cool-tone gloss: 5.1 + 6 vol',
    allergies: 'Cinnamon scent — avoid',
    notes: 'Shy at first — quiet appointments preferred.',
  },
];

export const PRODUCTS: Product[] = [
  { id: 'p-color-6n', name: 'Koleston 6/0', brand: 'Wella', category: 'Color', size: 60, unit: 'mL', stock: 8, reorder: 4, perUse: 30, cost: 9.20, status: 'ok' },
  { id: 'p-color-634', name: 'Koleston 6/34', brand: 'Wella', category: 'Color', size: 60, unit: 'mL', stock: 3, reorder: 4, perUse: 30, cost: 9.50, status: 'low' },
  { id: 'p-color-913', name: 'Koleston 9/13', brand: 'Wella', category: 'Color', size: 60, unit: 'mL', stock: 6, reorder: 3, perUse: 25, cost: 9.50, status: 'ok' },
  { id: 'p-color-101', name: 'Color Touch 10/1', brand: 'Wella', category: 'Color', size: 60, unit: 'mL', stock: 5, reorder: 3, perUse: 30, cost: 7.80, status: 'ok' },
  { id: 'p-color-51', name: 'Color Touch 5/1', brand: 'Wella', category: 'Color', size: 60, unit: 'mL', stock: 2, reorder: 3, perUse: 30, cost: 7.80, status: 'low' },
  { id: 'p-developer-6', name: 'Welloxon 1.9%', brand: 'Wella', category: 'Developer', size: 1000, unit: 'mL', stock: 2, reorder: 1, perUse: 60, cost: 14.50, status: 'ok' },
  { id: 'p-developer-20', name: 'Welloxon 6%', brand: 'Wella', category: 'Developer', size: 1000, unit: 'mL', stock: 4, reorder: 2, perUse: 60, cost: 14.50, status: 'ok' },
  { id: 'p-developer-30', name: 'Welloxon 9%', brand: 'Wella', category: 'Developer', size: 1000, unit: 'mL', stock: 1, reorder: 2, perUse: 60, cost: 14.50, status: 'low' },
  { id: 'p-lightener', name: 'Blondor Freelights', brand: 'Wella', category: 'Lightener', size: 800, unit: 'g', stock: 1, reorder: 1, perUse: 80, cost: 38.00, status: 'low' },
  { id: 'p-bond-builder', name: 'No.1 Bond Multiplier', brand: 'Olaplex', category: 'Treatment', size: 525, unit: 'mL', stock: 2, reorder: 1, perUse: 15, cost: 78.00, status: 'ok' },
  { id: 'p-mask-repair', name: 'Absolut Repair Mask', brand: "L'Oréal", category: 'Treatment', size: 500, unit: 'mL', stock: 3, reorder: 2, perUse: 25, cost: 32.00, status: 'ok' },
  { id: 'p-curl-cream', name: 'Curl Manifesto Cream', brand: 'Kérastase', category: 'Styling', size: 200, unit: 'mL', stock: 4, reorder: 2, perUse: 12, cost: 42.00, status: 'ok' },
  { id: 'p-pomade', name: 'Matte Clay', brand: 'Hanz de Fuko', category: 'Styling', size: 60, unit: 'g', stock: 6, reorder: 3, perUse: 4, cost: 19.00, status: 'ok' },
  { id: 'p-purple-shampoo', name: 'Blondifier Cool', brand: "L'Oréal", category: 'Shampoo', size: 300, unit: 'mL', stock: 0, reorder: 2, perUse: 8, cost: 18.50, status: 'out' },
];

export const TODAY_APPOINTMENTS: Appointment[] = [
  {
    id: 'a-t-1', clientId: 'c1', start: isoOffset(0, 11, 0), end: isoOffset(0, 13, 0),
    service: 'Root Touch-up + Gloss', status: 'upcoming', price: 145,
    products: [{ productId: 'p-color-6n', amount: 30 }, { productId: 'p-color-634', amount: 30 }, { productId: 'p-developer-20', amount: 60 }],
  },
  {
    id: 'a-t-2', clientId: 'c3', start: isoOffset(0, 15, 30), end: isoOffset(0, 16, 15),
    service: 'Mens Cut', status: 'upcoming', price: 65,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-t-3', clientId: 'c6', start: isoOffset(0, 17, 0), end: isoOffset(0, 18, 30),
    service: 'Consultation', status: 'upcoming', price: 45,
    products: [],
  },
];

export const WEEK_APPOINTMENTS: Appointment[] = [
  ...TODAY_APPOINTMENTS,
  {
    id: 'a-w-1', clientId: 'c5', start: isoOffset(1, 10, 0), end: isoOffset(1, 11, 30),
    service: 'Toner + Trim', status: 'upcoming', price: 165,
    products: [{ productId: 'p-color-101', amount: 30 }, { productId: 'p-developer-6', amount: 60 }],
  },
  {
    id: 'a-w-2', clientId: 'c2', start: isoOffset(2, 14, 0), end: isoOffset(2, 17, 0),
    service: 'Balayage Refresh', status: 'upcoming', price: 240,
    products: [{ productId: 'p-lightener', amount: 80 }, { productId: 'p-developer-30', amount: 60 }, { productId: 'p-bond-builder', amount: 15 }],
  },
  {
    id: 'a-w-3', clientId: 'c7', start: isoOffset(3, 17, 0), end: isoOffset(3, 18, 0),
    service: 'Cut + Beard', status: 'upcoming', price: 70,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-w-4', clientId: 'c6', start: isoOffset(5, 13, 0), end: isoOffset(5, 15, 0),
    service: 'Cut + Gloss', status: 'upcoming', price: 145,
    products: [{ productId: 'p-color-6n', amount: 30 }, { productId: 'p-developer-20', amount: 60 }],
  },
  {
    id: 'a-w-5', clientId: 'c1', start: isoOffset(-1, 14, 0), end: isoOffset(-1, 15, 30),
    service: 'Consultation', status: 'completed', paid: true, price: 45,
    products: [],
  },
  // Historical completed appointments — makes Reports, ClientDetail history, and Recent filter look realistic
  {
    id: 'a-h-01', clientId: 'c3', start: isoOffset(-21, 15, 30), end: isoOffset(-21, 16, 15),
    service: 'Mens Cut', status: 'completed', paid: true, price: 65,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-02', clientId: 'c7', start: isoOffset(-21, 17, 0), end: isoOffset(-21, 18, 0),
    service: 'Cut + Beard', status: 'completed', paid: true, price: 70,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-03', clientId: 'c1', start: isoOffset(-28, 11, 0), end: isoOffset(-28, 13, 0),
    service: 'Root Touch-up + Gloss', status: 'completed', paid: true, price: 145,
    products: [{ productId: 'p-color-6n', amount: 30 }, { productId: 'p-color-634', amount: 30 }, { productId: 'p-developer-20', amount: 60 }],
  },
  {
    id: 'a-h-04', clientId: 'c5', start: isoOffset(-35, 10, 0), end: isoOffset(-35, 11, 30),
    service: 'Toner + Trim', status: 'completed', paid: true, price: 165,
    products: [{ productId: 'p-color-101', amount: 30 }, { productId: 'p-developer-6', amount: 60 }],
  },
  {
    id: 'a-h-05', clientId: 'c2', start: isoOffset(-42, 14, 0), end: isoOffset(-42, 17, 0),
    service: 'Balayage Refresh', status: 'completed', paid: true, price: 240,
    products: [{ productId: 'p-lightener', amount: 80 }, { productId: 'p-developer-30', amount: 60 }, { productId: 'p-bond-builder', amount: 15 }],
  },
  {
    id: 'a-h-06', clientId: 'c4', start: isoOffset(-42, 10, 0), end: isoOffset(-42, 10, 45),
    service: 'Deep Treatment', status: 'completed', paid: true, price: 60,
    products: [{ productId: 'p-mask-repair', amount: 25 }],
  },
  {
    id: 'a-h-07', clientId: 'c3', start: isoOffset(-42, 15, 30), end: isoOffset(-42, 16, 15),
    service: 'Mens Cut', status: 'completed', paid: true, price: 65,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-08', clientId: 'c7', start: isoOffset(-42, 17, 0), end: isoOffset(-42, 18, 0),
    service: 'Cut + Beard', status: 'completed', paid: true, price: 70,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-09', clientId: 'c8', start: isoOffset(-49, 11, 0), end: isoOffset(-49, 13, 0),
    service: 'Root Touch-up + Gloss', status: 'completed', paid: true, price: 145,
    products: [{ productId: 'p-color-51', amount: 30 }, { productId: 'p-developer-20', amount: 60 }],
  },
  {
    id: 'a-h-10', clientId: 'c6', start: isoOffset(-30, 13, 0), end: isoOffset(-30, 14, 0),
    service: 'Cut + Style', status: 'completed', paid: true, price: 75,
    products: [{ productId: 'p-curl-cream', amount: 12 }],
  },
  {
    id: 'a-h-11', clientId: 'c1', start: isoOffset(-56, 11, 0), end: isoOffset(-56, 12, 15),
    service: 'Cut + Treatment', status: 'completed', paid: true, price: 95,
    products: [{ productId: 'p-mask-repair', amount: 25 }],
  },
  {
    id: 'a-h-12', clientId: 'c5', start: isoOffset(-63, 10, 0), end: isoOffset(-63, 11, 30),
    service: 'Toner + Trim', status: 'completed', paid: true, price: 165,
    products: [{ productId: 'p-color-101', amount: 30 }, { productId: 'p-developer-6', amount: 60 }],
  },
  {
    id: 'a-h-13', clientId: 'c2', start: isoOffset(-70, 14, 0), end: isoOffset(-70, 16, 30),
    service: 'Full Color', status: 'completed', paid: true, price: 195,
    products: [{ productId: 'p-color-6n', amount: 30 }, { productId: 'p-developer-20', amount: 60 }, { productId: 'p-bond-builder', amount: 15 }],
  },
  {
    id: 'a-h-14', clientId: 'c3', start: isoOffset(-63, 15, 30), end: isoOffset(-63, 16, 15),
    service: 'Mens Cut', status: 'completed', paid: true, price: 65,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-15', clientId: 'c7', start: isoOffset(-63, 17, 0), end: isoOffset(-63, 18, 0),
    service: 'Cut + Beard', status: 'completed', paid: true, price: 70,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-16', clientId: 'c6', start: isoOffset(-60, 13, 0), end: isoOffset(-60, 15, 0),
    service: 'Root Touch-up + Gloss', status: 'completed', paid: true, price: 145,
    products: [{ productId: 'p-color-6n', amount: 30 }, { productId: 'p-developer-20', amount: 60 }],
  },
  {
    id: 'a-h-17', clientId: 'c1', start: isoOffset(-84, 11, 0), end: isoOffset(-84, 13, 0),
    service: 'Root Touch-up + Gloss', status: 'completed', paid: true, price: 145,
    products: [{ productId: 'p-color-6n', amount: 30 }, { productId: 'p-color-634', amount: 30 }, { productId: 'p-developer-20', amount: 60 }, { productId: 'p-bond-builder', amount: 15 }],
  },
  {
    id: 'a-h-18', clientId: 'c4', start: isoOffset(-84, 10, 0), end: isoOffset(-84, 10, 45),
    service: 'Deep Treatment', status: 'completed', paid: true, price: 60,
    products: [{ productId: 'p-mask-repair', amount: 25 }, { productId: 'p-curl-cream', amount: 12 }],
  },
  {
    id: 'a-h-19', clientId: 'c8', start: isoOffset(-84, 11, 0), end: isoOffset(-84, 12, 0),
    service: 'Cut + Style', status: 'completed', paid: true, price: 75,
    products: [{ productId: 'p-curl-cream', amount: 12 }],
  },
  {
    id: 'a-h-20', clientId: 'c5', start: isoOffset(-91, 10, 0), end: isoOffset(-91, 12, 30),
    service: 'Full Color', status: 'completed', paid: true, price: 195,
    products: [{ productId: 'p-lightener', amount: 80 }, { productId: 'p-developer-20', amount: 60 }, { productId: 'p-color-101', amount: 30 }],
  },
  {
    id: 'a-h-21', clientId: 'c3', start: isoOffset(-84, 15, 30), end: isoOffset(-84, 16, 15),
    service: 'Mens Cut', status: 'completed', paid: true, price: 65,
    products: [{ productId: 'p-pomade', amount: 4 }],
  },
  {
    id: 'a-h-22', clientId: 'c2', start: isoOffset(-14, 14, 0), end: isoOffset(-14, 15, 0),
    service: 'Cut + Style', status: 'no-show', price: 75,
    products: [{ productId: 'p-curl-cream', amount: 12 }],
  },
];

export const SERVICES: Service[] = [
  { id: 's-cut', name: 'Cut + Style', duration: 60, price: 75, defaults: [], recommended: ['p-curl-cream', 'p-mask-repair'] },
  { id: 's-mens', name: 'Mens Cut', duration: 45, price: 65, defaults: ['p-pomade'], recommended: [] },
  { id: 's-cutbeard', name: 'Cut + Beard', duration: 60, price: 70, defaults: ['p-pomade'], recommended: [] },
  { id: 's-roots', name: 'Root Touch-up + Gloss', duration: 120, price: 145, defaults: ['p-color-6n', 'p-color-634', 'p-developer-20'], recommended: ['p-bond-builder', 'p-mask-repair'] },
  { id: 's-color', name: 'Full Color', duration: 150, price: 195, defaults: ['p-color-6n', 'p-developer-20'], recommended: ['p-bond-builder', 'p-mask-repair'] },
  { id: 's-balayage', name: 'Balayage Refresh', duration: 180, price: 240, defaults: ['p-lightener', 'p-developer-30', 'p-bond-builder'], recommended: ['p-color-913', 'p-purple-shampoo'] },
  { id: 's-toner', name: 'Toner + Trim', duration: 90, price: 165, defaults: ['p-color-101', 'p-developer-6'], recommended: ['p-purple-shampoo'] },
  { id: 's-treat', name: 'Deep Treatment', duration: 45, price: 60, defaults: ['p-mask-repair'], recommended: [] },
  { id: 's-consult', name: 'Consultation', duration: 30, price: 45, defaults: [], recommended: [] },
];

export const DEFAULT_SCHEDULE: Schedule = {
  0: { open: false, start: '10:00', end: '16:00' },
  1: { open: true, start: '09:00', end: '18:00' },
  2: { open: true, start: '09:00', end: '18:00' },
  3: { open: true, start: '09:00', end: '18:00' },
  4: { open: true, start: '09:00', end: '20:00' },
  5: { open: true, start: '09:00', end: '20:00' },
  6: { open: true, start: '10:00', end: '17:00' },
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
