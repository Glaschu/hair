import fs from 'fs';
import path from 'path';
import nacl from 'tweetnacl';
import { generateKeyPair, unsealBooking } from '../sealedBox';

/**
 * The booking page and the app are two separate implementations of the
 * same envelope — one in a browser, one in React Native. If their byte
 * layouts ever drift, bookings arrive unreadable and the only symptom is
 * a client who booked and never appeared. So this runs the real seal()
 * out of the shipped page against the app's unseal.
 */
function sealFromBookingPage(): (plaintext: string, publicKey: string) => string {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../booking/site/book.js'), 'utf8',
  );
  const start = src.indexOf('function seal(');
  const end = src.indexOf('async function load()');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  // eslint-disable-next-line no-new-func
  return new Function('nacl', `${src.slice(start, end)}; return seal;`)(nacl);
}

describe('page ↔ app interop', () => {
  const seal = sealFromBookingPage();

  it('opens a booking sealed by the actual page code', () => {
    const salon = generateKeyPair();
    const booking = {
      name: 'Sara Whitfield',
      phone: '07700 900118',
      email: 'sara@example.com',
      note: 'Growing out a box dye — never had a reaction.',
    };

    const sealed = seal(JSON.stringify(booking), salon.publicKey);
    expect(unsealBooking(sealed, salon.secretKey)).toEqual(booking);
  });

  it('still matches for non-ASCII details', () => {
    const salon = generateKeyPair();
    const booking = { name: 'Zoë Ó Braonáin', phone: '+44 7700 900118' };
    const sealed = seal(JSON.stringify(booking), salon.publicKey);
    expect(unsealBooking(sealed, salon.secretKey)).toMatchObject(booking);
  });

  it("seals to the salon's key alone", () => {
    const salon = generateKeyPair();
    const someoneElse = generateKeyPair();
    const sealed = seal(JSON.stringify({ name: 'Sara', phone: '07700 900118' }), salon.publicKey);
    expect(unsealBooking(sealed, someoneElse.secretKey)).toBeNull();
  });
});
