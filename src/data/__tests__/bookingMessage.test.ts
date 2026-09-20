import { bookingInviteMessage, firstNameOf } from '../bookingMessage';
import { Service } from '../types';

const service: Service = {
  id: 's-consult', name: 'Consultation', duration: 30, price: 45,
  defaults: [], recommended: [],
};

describe('the invitation text', () => {
  it('reads like her, with the link on its own line', () => {
    const msg = bookingInviteMessage({
      firstName: 'Sara', studioName: 'Iris', service,
      slotCount: 3, url: 'https://book.iris.co.uk/b/abc123', depositPercent: 50,
    });
    expect(msg).toContain('Hi Sara —');
    expect(msg).toContain('3 times for Consultation');
    expect(msg).toContain('\nhttps://book.iris.co.uk/b/abc123\n');
    expect(msg).toContain('£45, 50% up front');
    expect(msg.trimEnd().endsWith('Iris')).toBe(true);
  });

  it('stays grammatical for a single time', () => {
    const msg = bookingInviteMessage({
      firstName: 'Theo', studioName: 'Iris', service, slotCount: 1,
      url: 'https://x.co/b/1',
    });
    expect(msg).toContain('here is a time for Consultation');
    expect(msg).not.toContain('1 times');
  });

  it('works without a name or a deposit rule', () => {
    const msg = bookingInviteMessage({
      studioName: 'Iris', service, slotCount: 2, url: 'https://x.co/b/1',
    });
    expect(msg.startsWith('here are 2 times')).toBe(true);
    expect(msg).toContain('£45.');
    expect(msg).not.toContain('up front');
  });
});

describe('firstNameOf', () => {
  it('takes the first name only, so a leaked link shows little', () => {
    expect(firstNameOf('Margot Lebreton')).toBe('Margot');
    expect(firstNameOf('  Saoirse   Whelan ')).toBe('Saoirse');
    expect(firstNameOf('Cher')).toBe('Cher');
    expect(firstNameOf('')).toBe('');
  });
});
