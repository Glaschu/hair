import { deductStock, restoreStock, stockStatus } from '../stock';
import { Product } from '../types';

const mkProduct = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Test', brand: 'B', category: 'Color',
  size: 100, unit: 'ml', stock: 10, reorder: 3, perUse: 50, cost: 5,
  status: 'ok', ...over,
});

describe('stockStatus', () => {
  it('is out at or below zero', () => {
    expect(stockStatus(0, 3)).toBe('out');
    expect(stockStatus(-1, 3)).toBe('out');
  });
  it('is low at or below the reorder threshold', () => {
    expect(stockStatus(3, 3)).toBe('low');
    expect(stockStatus(2, 3)).toBe('low');
  });
  it('is ok above the reorder threshold', () => {
    expect(stockStatus(4, 3)).toBe('ok');
  });
});

describe('deductStock', () => {
  it('subtracts usage measured in containers', () => {
    const p = deductStock(mkProduct({ stock: 10 }), 50); // 50ml of a 100ml container
    expect(p.stock).toBe(9.5);
    expect(p.status).toBe('ok');
  });
  it('never goes below zero', () => {
    const p = deductStock(mkProduct({ stock: 0.2 }), 500);
    expect(p.stock).toBe(0);
    expect(p.status).toBe('out');
  });
  it('flags low when crossing the reorder threshold', () => {
    const p = deductStock(mkProduct({ stock: 3.4, reorder: 3 }), 50);
    expect(p.stock).toBe(2.9);
    expect(p.status).toBe('low');
  });
  it('rounds stock to one decimal place', () => {
    const p = deductStock(mkProduct({ stock: 10, size: 30 }), 50); // 50/30 = 1.666…
    expect(p.stock).toBe(8.3);
  });
});

describe('restoreStock', () => {
  it('adds the usage back', () => {
    const p = restoreStock(mkProduct({ stock: 9.5 }), 50);
    expect(p.stock).toBe(10);
  });
  it('recomputes status as stock recovers', () => {
    const p = restoreStock(mkProduct({ stock: 2, reorder: 3, status: 'low' }), 200);
    expect(p.stock).toBe(4);
    expect(p.status).toBe('ok');
  });
});
