import { createHash, createHmac, randomUUID } from 'node:crypto';
import { calculateTotals, PurchaseError, surveyQuestions } from './data/checkout-totals.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const isRequestId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const cartKey = totals => JSON.stringify(totals.items);
const ownerKey = owner => {
  if (typeof owner !== 'string' || !/^[0-9a-f]{64}$/.test(owner)) throw new PurchaseError('Actualiza la página e inténtalo de nuevo.', 403);
  return hash(owner);
};

export function createPurchaseFlow({ products, store, getStripe }) {
  const pending = new Map();
  return {
    async submitSurvey(owner, body) {
      const ownerHash = ownerKey(owner);
      const totals = calculateTotals(body.items, products, true);
      if (!isRequestId(body.requestId)) throw new PurchaseError('La solicitud no es válida. Actualiza la página.');
      if (!Array.isArray(body.ratings) || body.ratings.length !== surveyQuestions.length ||
          body.ratings.some(r => !Number.isInteger(r) || r < 1 || r > 5)) {
        throw new PurchaseError('Elige una calificación.');
      }
      if (body.comments !== undefined && typeof body.comments !== 'string') throw new PurchaseError('El comentario no es válido.');
      const comments = (body.comments || '').trim();
      if (comments.length > 200) throw new PurchaseError('El comentario admite hasta 200 caracteres.');
      const token = createHmac('sha256', owner).update(`survey:${body.requestId}`).digest('hex');
      await store.update(data => {
        const existing = data.surveys.find(s => s.ownerHash === ownerHash && s.requestId === body.requestId);
        if (existing) {
          if (existing.cartKey !== cartKey(totals) || JSON.stringify(existing.ratings) !== JSON.stringify(body.ratings) || existing.comments !== comments) {
            throw new PurchaseError('La solicitud ya fue registrada con otros datos. Vuelve a abrir la encuesta.', 409);
          }
          return;
        }
        data.surveys.push({ id: randomUUID(), ownerHash, requestId: body.requestId, tokenHash: hash(token),
          cartKey: cartKey(totals), ratings: body.ratings, comments, version: 3, createdAt: Date.now() });
      });
      return { surveyToken: token, ...totals };
    },

    async checkout(owner, body, origin) {
      const ownerHash = ownerKey(owner);
      if (!isRequestId(body.requestId)) throw new PurchaseError('La solicitud de pago no es válida.');
      const discounted = Boolean(body.surveyToken);
      const totals = calculateTotals(body.items, products, discounted);
      const stripe = getStripe();
      if (!stripe) throw new PurchaseError('Stripe de pruebas aún no está conectado. Conéctalo en la ventana de inicio de FiveBuys.', 503);
      const key = `${ownerHash}:${body.requestId}`;
      const attempt = await store.update(data => {
        const existing = data.attempts.find(a => a.key === key);
        if (existing) {
          // Stripe retiene las claves de idempotencia al menos 24 horas.
          if (Date.now() - existing.createdAt > 23 * 3600000) throw new PurchaseError('Este intento venció. Vuelve al carrito para iniciar otro.', 409);
          if (existing.cartKey !== cartKey(totals) || existing.discounted !== discounted || existing.tokenHash !== (discounted ? hash(String(body.surveyToken)) : null)) {
            throw new PurchaseError('El carrito cambió. Vuelve al carrito antes de pagar.', 409);
          }
          return existing;
        }
        let survey;
        if (discounted) {
          survey = data.surveys.find(s => s.ownerHash === ownerHash && s.tokenHash === hash(String(body.surveyToken)));
          if (!survey || survey.cartKey !== cartKey(totals) || Date.now() - survey.createdAt > 86400000) {
            throw new PurchaseError('El descuento necesita una encuesta enviada para este carrito. Vuelve al carrito.', 409);
          }
          if (survey.attemptKey) throw new PurchaseError('Esta encuesta ya está asociada a un intento de pago. Reintenta ese pago o vuelve al carrito.', 409);
          survey.attemptKey = key;
        }
        const value = { id: randomUUID(), key, cartKey: cartKey(totals), discounted,
          tokenHash: discounted ? hash(String(body.surveyToken)) : null, surveyId: survey?.id,
          origin, createdAt: Date.now() };
        data.attempts.push(value);
        return value;
      });
      if (attempt.origin !== origin) throw new PurchaseError('La dirección de la tienda cambió. Vuelve al carrito.', 409);
      if (attempt.session) {
        const session = await stripe.checkout.sessions.retrieve(attempt.session.id);
        if (session.status !== 'open') throw new PurchaseError('Este intento de pago terminó. Vuelve al carrito para iniciar otro.', 409);
        return checkedSession(session, totals);
      }
      if (pending.has(key)) return pending.get(key);
      const operation = (async () => {
        let discounts;
        if (discounted) {
          const coupon = await stripe.coupons.create({ amount_off: totals.discount, currency: 'clp', duration: 'once',
            name: 'Encuesta de satisfacción: 5 %', max_redemptions: 1 }, { idempotencyKey: `survey-coupon-${attempt.id}` });
          if (coupon.livemode !== false) throw new PurchaseError('Solo se permite Stripe de pruebas.', 503);
          discounts = [{ coupon: coupon.id }];
        }
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'], mode: 'payment', locale: 'es',
          line_items: totals.items.map(item => {
            const product = products.find(p => p.id === item.id);
            return { price_data: { currency: 'clp', product_data: { name: product.name }, unit_amount: product.price }, quantity: item.quantity };
          }),
          // Stripe rechaza la presencia simultánea, incluso allow_promotion_codes: false.
          ...(discounts ? { discounts } : { allow_promotion_codes: false }),
          adaptive_pricing: { enabled: false },
          success_url: `${origin}/success`, cancel_url: `${origin}/cancel`,
          metadata: { survey_id: attempt.surveyId || '', attempt_id: attempt.id }
        }, { idempotencyKey: `survey-checkout-${attempt.id}` });
        const result = checkedSession(session, totals);
        await store.update(data => { data.attempts.find(a => a.key === key).session = { id: session.id }; });
        return result;
      })();
      pending.set(key, operation);
      try { return await operation; } finally { pending.delete(key); }
    }
  };
}

function checkedSession(session, totals) {
  if (session.livemode !== false || session.currency !== 'clp' || session.amount_subtotal !== totals.subtotal ||
      session.amount_total !== totals.total || session.total_details?.amount_discount !== totals.discount ||
      typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
    throw new PurchaseError('No se pudo confirmar el importe del pago de prueba. Tu carrito se conserva.', 502);
  }
  return { ...totals, url: session.url };
}
