import { readFileSync } from 'fs';
import { join } from 'path';
import { BOOKING_GUIDE } from '../bookingGuide';

/**
 * The guide is written twice — in the app and on the booking site — and a
 * guide that disagrees with itself is worse than none. It also names buttons
 * by their labels, so a renamed button must break this rather than the guide.
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const unescape = (html: string) => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

it('the site says the same as the app, step for step', () => {
  const page = unescape(read('booking/site/guide.html'));
  for (const section of BOOKING_GUIDE) {
    expect(page).toContain(section.heading);
    for (const step of section.steps) {
      expect(page).toContain(step.title);
      expect(page).toContain(step.body);
      if (step.note) expect(page).toContain(step.note);
    }
  }
});

it('every button it names exists under that name', () => {
  const screens = [
    'src/screens/SettingsScreen.tsx', 'src/screens/BookingSetupScreen.tsx', 'src/screens/CloudAccessScreen.tsx',
    'src/screens/ClientDetailScreen.tsx', 'src/screens/AppointmentDetailScreen.tsx', 'booking/site/setup.html',
  ].map(read).join('\n');
  const named = BOOKING_GUIDE.flatMap((s) => s.steps)
    .flatMap((step) => [...step.body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  expect(named.length).toBeGreaterThan(8);
  for (const label of named) expect(screens).toContain(label);
});

it('the setup page points at the guide', () => {
  expect(read('booking/site/setup.html')).toContain('href="/guide.html"');
});
