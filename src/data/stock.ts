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
