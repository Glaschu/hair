import { diffById } from '../diff';

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe('diffById', () => {
  it('reports nothing for identical arrays', () => {
    const a = item('a');
    const b = item('b');
    const { removed, changed } = diffById([a, b], [a, b]);
    expect(removed).toEqual([]);
    expect(changed).toEqual([]);
  });

  it('reports new items as changed', () => {
    const a = item('a');
    const b = item('b');
    const { removed, changed } = diffById([a], [a, b]);
    expect(removed).toEqual([]);
    expect(changed).toEqual([b]);
  });

  it('reports replaced references as changed, untouched ones not', () => {
    const a = item('a');
    const b = item('b');
    const b2 = item('b', { name: 'edited' });
    const { removed, changed } = diffById([a, b], [a, b2]);
    expect(removed).toEqual([]);
    expect(changed).toEqual([b2]);
  });

  it('reports missing items as removed', () => {
    const a = item('a');
    const b = item('b');
    const { removed, changed } = diffById([a, b], [a]);
    expect(removed).toEqual([b]);
    expect(changed).toEqual([]);
  });

  it('handles wipe-all and load-from-empty', () => {
    const a = item('a');
    expect(diffById([a], [])).toEqual({ removed: [a], changed: [] });
    expect(diffById([], [a])).toEqual({ removed: [], changed: [a] });
  });
});
