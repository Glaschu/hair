import { Product, ProductStatus } from './types';

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function stockStatus(stock: number, reorder: number): ProductStatus {
  if (stock <= 0) return 'out';
  if (stock <= reorder) return 'low';
  return 'ok';
}

/**
 * Apply usage of `amount` (in the product's own units, e.g. ml) to a product,
 * returning an updated product with recomputed stock and status. Stock is held in
 * whole containers, so usage is divided by the container `size`. Never goes negative.
 */
export function deductStock(product: Product, amount: number): Product {
  const stock = round1(Math.max(0, product.stock - amount / product.size));
  return { ...product, stock, status: stockStatus(stock, product.reorder) };
}

/** Reverse a usage of `amount`, restoring stock (used when an appointment is un-completed). */
export function restoreStock(product: Product, amount: number): Product {
  const stock = round1(product.stock + amount / product.size);
  return { ...product, stock, status: stockStatus(stock, product.reorder) };
}

/**
 * Stock counts are decimal (half a tub of bleach is 0.5), so the count
 * fields hold text while being typed: a numeric state would round-trip
 * "3." through Number() and swallow the decimal point before the user
 * could type the digit after it.
 */

/** Keeps only what can still become a decimal count, so a half-typed "3." survives. */
export function sanitizeStockInput(text: string): string {
  const cleaned = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

/** A typed count as a number, or null while it isn't a usable one ("", "."). */
export function parseStockInput(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Shortest sensible text for a count: 3 → "3", 3.5 → "3.5". */
export function formatStockInput(n: number): string {
  return String(Math.round(n * 100) / 100);
}
