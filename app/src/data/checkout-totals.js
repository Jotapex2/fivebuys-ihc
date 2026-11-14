export const surveyQuestions = ['¿Cómo ha sido tu experiencia al elegir y preparar tu compra?'];

export class PurchaseError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function calculateTotals(items, products, discounted = false) {
  if (!Array.isArray(items) || !items.length || items.length > products.length) {
    throw new PurchaseError('El carrito está vacío o contiene productos inválidos.');
  }
  const seen = new Set();
  const normalized = items.map(item => {
    const product = products.find(p => p.id === item?.id);
    const quantity = Number(item?.quantity);
    if (!product || seen.has(product.id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new PurchaseError('Revisa los productos y las cantidades (entre 1 y 20 por producto).');
    }
    seen.add(product.id);
    return { id: product.id, quantity };
  }).sort((a, b) => a.id - b.id);
  const subtotal = normalized.reduce((sum, item) => sum + products.find(p => p.id === item.id).price * item.quantity, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new PurchaseError('El importe del carrito no es válido.');
  // CLP: pesos enteros; medio peso se redondea hacia arriba, una vez sobre el subtotal.
  const discount = discounted ? Number((BigInt(subtotal) * 5n + 50n) / 100n) : 0;
  return { items: normalized, subtotal, discount, total: subtotal - discount, currency: 'clp' };
}
