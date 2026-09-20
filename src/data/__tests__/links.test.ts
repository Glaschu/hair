import { Linking } from 'react-native';
import { instagramHandle, openInstagram } from '../links';

describe('instagramHandle', () => {
  it('strips the @ a stylist naturally types', () => {
    expect(instagramHandle('@margot.hair')).toBe('margot.hair');
    expect(instagramHandle('  @margot.hair  ')).toBe('margot.hair');
  });

  it('accepts a bare handle', () => {
    expect(instagramHandle('margot_hair99')).toBe('margot_hair99');
  });

  it('pulls the handle out of a pasted profile link', () => {
    expect(instagramHandle('https://www.instagram.com/margot.hair')).toBe('margot.hair');
    expect(instagramHandle('instagram.com/margot.hair/')).toBe('margot.hair');
    expect(instagramHandle('https://instagram.com/margot.hair?igshid=abc')).toBe('margot.hair');
  });

  it('returns nothing for empty or unusable input', () => {
    expect(instagramHandle(undefined)).toBe('');
    expect(instagramHandle('')).toBe('');
    expect(instagramHandle('@')).toBe('');
    expect(instagramHandle('not a handle!')).toBe('');
  });
});

describe('openInstagram', () => {
  let canOpen: jest.SpyInstance;
  let open: jest.SpyInstance;

  beforeEach(() => {
    // jest-expo's Linking is already a mock, so the spies wrap a shared
    // fn — clear it or call history leaks between tests.
    canOpen = jest.spyOn(Linking, 'canOpenURL');
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    canOpen.mockClear();
    open.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('goes straight to the DM thread when Instagram is installed', async () => {
    canOpen.mockResolvedValue(true as never);
    await openInstagram('@margot.hair');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://ig.me/m/margot.hair');
  });

  it('falls back to the profile in-app if Instagram refuses the DM link', async () => {
    canOpen.mockResolvedValue(true as never);
    open.mockRejectedValueOnce(new Error('no handler') as never);
    await openInstagram('margot.hair');
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      'https://ig.me/m/margot.hair',
      'instagram://user?username=margot.hair',
    ]);
  });

  it('uses the web profile rather than a useless Safari DM page with no app', async () => {
    canOpen.mockResolvedValue(false as never);
    await openInstagram('margot.hair');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://www.instagram.com/margot.hair');
  });

  it('does nothing when there is no usable handle', async () => {
    canOpen.mockResolvedValue(true as never);
    await openInstagram('  ');
    expect(open).not.toHaveBeenCalled();
  });
});
