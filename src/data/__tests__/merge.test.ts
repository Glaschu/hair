import { mergeById, mergeClients, mergeAppointments, unionPhotos } from '../merge';
import { Appointment, Client, ClientPhoto, Product } from '../types';

const mkClient = (over: Partial<Client>): Client => ({
  id: 'c1',
  name: 'Margot',
  tone: '#C49A7A',
  phone: '',
  email: '',
  since: '2024',
  hair: { type: 'Wavy', length: 'Mid-length', natural: 'Dark brown' },
  formula: 'Not recorded',
  allergies: 'None on file',
  notes: '',
  ...over,
});

const mkAppt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1',
  clientId: 'c1',
  start: '2026-07-16T10:00:00.000Z',
  end: '2026-07-16T12:00:00.000Z',
  service: 'Root Touch-up + Gloss',
  status: 'completed',
  price: 145,
  products: [],
  ...over,
});

const mkProduct = (over: Partial<Product>): Product => ({
  id: 'p1', name: 'Koleston 6/0', brand: 'Wella', category: 'Color',
  size: 60, unit: 'mL', stock: 5, reorder: 2, perUse: 30, cost: 9.2, status: 'ok',
  ...over,
});

const photo = (id: string, date: string): ClientPhoto => ({ id, date, url: `${id}.jpg`, label: '' });

describe('mergeClients', () => {
  it('keeps a handle added on one device when the other device wrote later', () => {
    // Phone added the Instagram handle; iPad then saved the same client
    // (from an edit that never knew about the handle) a minute later.
    const phone = [mkClient({ instagram: '@margot.hair', updatedAt: 1_000 })];
    const ipad = [mkClient({ updatedAt: 2_000, notes: 'Likes head massage' })];

    const merged = mergeClients(phone, ipad);
    expect(merged[0].instagram).toBe('@margot.hair');
    expect(merged[0].notes).toBe('Likes head massage');
    expect(merged[0].updatedAt).toBe(2_000);
  });

  it('is symmetric — same result whichever device merges', () => {
    const phone = [mkClient({ instagram: '@margot.hair', updatedAt: 1_000 })];
    const ipad = [mkClient({ updatedAt: 2_000 })];
    expect(mergeClients(phone, ipad)[0].instagram)
      .toBe(mergeClients(ipad, phone)[0].instagram);
  });

  it('lets a real edit win over an older value', () => {
    const older = [mkClient({ instagram: '@old', updatedAt: 1_000 })];
    const newer = [mkClient({ instagram: '@new', updatedAt: 2_000 })];
    expect(mergeClients(older, newer)[0].instagram).toBe('@new');
  });

  it('fills blanks for contact, formula, allergies and hair', () => {
    const filled = [mkClient({
      updatedAt: 1_000,
      phone: '07700 900 000', email: 'm@example.com',
      formula: '30g 6/0 + 20vol', allergies: 'PPD sensitive',
      hair: { type: 'Fine, wavy', length: 'Mid-back', natural: 'Level 5' },
    })];
    // Blank hair fields are what a stripped/sanitised record looks like.
    const bare = [mkClient({ updatedAt: 2_000, hair: { type: '', length: '', natural: '' } })];

    const m = mergeClients(filled, bare)[0];
    expect(m.phone).toBe('07700 900 000');
    expect(m.email).toBe('m@example.com');
    expect(m.formula).toBe('30g 6/0 + 20vol');
    expect(m.allergies).toBe('PPD sensitive');   // never lose a sensitivity
    expect(m.hair.length).toBe('Mid-back');
  });

  it('does not treat a real default as a blank to be overwritten', () => {
    // "Mid-length" is a genuine value the newer device chose — keep it.
    const older = [mkClient({ updatedAt: 1_000, hair: { type: 'Fine', length: 'Mid-back', natural: 'Level 5' } })];
    const newer = [mkClient({ updatedAt: 2_000 })];
    expect(mergeClients(older, newer)[0].hair.length).toBe('Mid-length');
  });

  it('keeps photos taken on both devices', () => {
    const phone = [mkClient({ updatedAt: 1_000, photos: [photo('p-old', '2026-07-01T10:00:00.000Z')] })];
    const ipad = [mkClient({ updatedAt: 2_000, photos: [photo('p-new', '2026-07-16T10:00:00.000Z')] })];

    const merged = mergeClients(phone, ipad)[0];
    expect(merged.photos?.map((p) => p.id)).toEqual(['p-new', 'p-old']); // newest first
  });

  it('takes records that only exist on one side, and honours tombstones', () => {
    const local = [mkClient({ id: 'c1', updatedAt: 1_000 })];
    const remote = [mkClient({ id: 'c2', name: 'Theo', updatedAt: 1_000 })];
    expect(mergeClients(local, remote).map((c) => c.id).sort()).toEqual(['c1', 'c2']);

    // Deleted after its last edit → stays deleted.
    expect(mergeClients(local, remote, { c1: 2_000 }).map((c) => c.id)).toEqual(['c2']);
    // Edited after the delete → the edit wins.
    expect(mergeClients(local, remote, { c1: 500 }).map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });
});

describe('mergeAppointments', () => {
  it('keeps a visit record written on one device when the other marked it paid later', () => {
    const ipad = [mkAppt({
      updatedAt: 1_000,
      formula: '30g 6/0 + 30g 6/34',
      technique: 'Root smudge',
      timing: '35 min @ 20vol',
      nextNotes: 'Gloss refresh next time',
    })];
    const phone = [mkAppt({ updatedAt: 2_000, paid: true })];

    const m = mergeAppointments(ipad, phone)[0];
    expect(m.paid).toBe(true);
    expect(m.formula).toBe('30g 6/0 + 30g 6/34');
    expect(m.technique).toBe('Root smudge');
    expect(m.timing).toBe('35 min @ 20vol');
    expect(m.nextNotes).toBe('Gloss refresh next time');
  });

  it('still lets a rewritten note win', () => {
    const older = [mkAppt({ updatedAt: 1_000, notes: 'first' })];
    const newer = [mkAppt({ updatedAt: 2_000, notes: 'corrected' })];
    expect(mergeAppointments(older, newer)[0].notes).toBe('corrected');
  });
});

describe('mergeById', () => {
  it('replaces wholesale so a counted stock level is never half-merged', () => {
    const local = [mkProduct({ stock: 5, updatedAt: 1_000 })];
    const remote = [mkProduct({ stock: 0, status: 'out', updatedAt: 2_000 })];
    const m = mergeById(local, remote)[0];
    expect(m.stock).toBe(0);       // 0 is a real count, not a blank
    expect(m.status).toBe('out');
  });
});

describe('unionPhotos', () => {
  it('dedupes by id, preferring the winner copy', () => {
    const win = [{ ...photo('p1', '2026-07-01T10:00:00.000Z'), label: 'After' }];
    const lose = [photo('p1', '2026-07-01T10:00:00.000Z')];
    const u = unionPhotos(win, lose);
    expect(u).toHaveLength(1);
    expect(u[0].label).toBe('After');
  });

  it('handles missing arrays', () => {
    expect(unionPhotos(undefined, undefined)).toEqual([]);
    expect(unionPhotos([photo('p1', '2026-07-01T10:00:00.000Z')], undefined)).toHaveLength(1);
  });
});
