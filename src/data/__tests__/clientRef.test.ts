import { sealClientRef, openClientRef, clientIdForRef } from '../clientRef';
import { generateKeyPair } from '../sealedBox';

/**
 * The client a booking link was sent to, carried inside the link.
 *
 * What this has to guarantee: any of her devices can tell who a booking is for,
 * and nobody else — including whoever runs the service — can tell anything,
 * not even that two links went to the same person.
 */

const salon = generateKeyPair();

it('any of her devices can tell who the link was for', () => {
  // Every paired device holds the same salon keypair, so the phone opens what
  // the iPad sealed. Nothing had to be synced for that to work.
  const ref = sealClientRef('client-42', salon.publicKey);
  expect(openClientRef(ref, salon.secretKey)).toBe('client-42');
});

it('the service cannot read it', () => {
  const ref = sealClientRef('client-42', salon.publicKey);
  expect(ref).not.toContain('client-42');
  expect(openClientRef(ref, generateKeyPair().secretKey)).toBeNull();
});

it('two links to the same client look unrelated', () => {
  // A fresh seal every time — otherwise the service could count her regulars.
  const a = sealClientRef('client-42', salon.publicKey);
  const b = sealClientRef('client-42', salon.publicKey);
  expect(a).not.toBe(b);
});

it('a link made before references were sealed still resolves, from the device that sent it', () => {
  const legacy = (ref: string) => (ref === 'a1b2c3' ? 'client-7' : null);
  expect(clientIdForRef('a1b2c3', salon.secretKey, legacy)).toBe('client-7');
  expect(clientIdForRef(sealClientRef('client-9', salon.publicKey), salon.secretKey, legacy)).toBe('client-9');
});

it('rubbish resolves to nobody rather than throwing', () => {
  const none = () => null;
  expect(clientIdForRef('', salon.secretKey, none)).toBeNull();
  expect(clientIdForRef('c1.not-base64!!', salon.secretKey, none)).toBeNull();
  expect(openClientRef('c1.', salon.secretKey)).toBeNull();
});
