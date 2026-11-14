import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTotals } from '../src/data/checkout-totals.js';
import { products } from '../src/data/products.js';
import { createSurveyStore } from '../src/data/survey-storage.js';
import { createPurchaseFlow } from '../src/purchase-flow.js';

const runtime = await mkdtemp(join(tmpdir(), 'fivebuys-runtime-'));
// Nunca cargar .env/env; todos los archivos de datos son exclusivos de estas pruebas.
process.env.DOTENV_CONFIG_PATH = 'NUL';
process.env.STRIPE_SECRET_KEY = '';
process.env.SURVEY_FILE = join(runtime, 'http-surveys.json');
process.env.CONTACT_FILE = join(runtime, 'http-contacts.json');
const owner = 'a'.repeat(64);
const items = [{ id: 2, quantity: 1 }];
const ratings = Array(1).fill(1);
const surveyBody = () => ({ requestId: randomUUID(), items, ratings });

function fixture(overrides = {}) {
  const file = join(runtime, `${randomUUID()}.json`);
  const store = createSurveyStore(file);
  const calls = { coupons: [], sessions: [] };
  let discount = 0;
  let session;
  const stripe = {
    coupons: { async create(params, options) {
      calls.coupons.push({ params, options }); discount = params.amount_off;
      return { id: 'coupon_test', livemode: false };
    } },
    checkout: { sessions: {
      async create(params, options) {
        if ('discounts' in params && 'allow_promotion_codes' in params) {
          throw new Error('Stripe: discounts y allow_promotion_codes son excluyentes, incluso false.');
        }
        calls.sessions.push({ params, options });
        const subtotal = params.line_items.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0);
        session = { id: 'cs_test_fixture', status: 'open', livemode: false, currency: 'clp', amount_subtotal: subtotal,
          amount_total: subtotal - (params.discounts ? discount : 0),
          total_details: { amount_discount: params.discounts ? discount : 0 }, url: 'https://checkout.stripe.com/c/pay/cs_test_fixture', ...overrides };
        return session;
      },
      async retrieve() { return session; }
    } }
  };
  return { flow: createPurchaseFlow({ products, store, getStripe: () => stripe }), stripe, calls, file };
}

test('Importes originales, 5 % y redondeo entero, sin aceptar precios del navegador', () => {
  assert.equal(calculateTotals([{ id: 2, quantity: 1, price: 1 }], products).total, 999990);
  assert.equal(calculateTotals(items, products, true).total, 949990);
  const artificial = [{ id: 1, price: 110 }];
  assert.equal(calculateTotals([{ id: 1, quantity: 1 }], artificial, true).discount, 6);
  for (const product of products) for (let quantity = 1; quantity <= 20; quantity++) {
    const result = calculateTotals([{ id: product.id, quantity }], products, true);
    assert.equal(result.discount, Math.round(product.price * quantity * 0.05));
    assert.equal(result.total + result.discount, result.subtotal);
  }
});

test('Carritos vacíos, duplicados, productos inexistentes y cantidades inválidas se rechazan', () => {
  for (const invalid of [[], [{ id: 2, quantity: 21 }], [{ id: 2, quantity: 0 }], [{ id: 2, quantity: 1.5 }],
    [{ id: 999, quantity: 1 }], [...items, ...items]]) assert.throws(() => calculateTotals(invalid, products));
});

test('Compra normal y omisión no envían cupones ni descuento a Stripe', async () => {
  const f = fixture();
  const result = await f.flow.checkout(owner, { requestId: randomUUID(), items, discount: 999999, total: 1 }, 'http://localhost');
  assert.equal(result.total, 999990);
  assert.equal(result.discount, 0);
  assert.equal(f.calls.coupons.length, 0);
  assert.equal(f.calls.sessions[0].params.discounts, undefined);
});

test('Una puntuación baja obtiene el mismo 5 %, registro persistente y precios originales', async () => {
  const f = fixture();
  const survey = await f.flow.submitSurvey(owner, surveyBody());
  const result = await f.flow.checkout(owner, { requestId: randomUUID(), items, surveyToken: survey.surveyToken }, 'http://localhost');
  assert.equal(result.total, survey.total);
  assert.equal(result.total, 949990);
  assert.equal(f.calls.coupons[0].params.amount_off, 50000);
  assert.equal(f.calls.coupons[0].params.max_redemptions, 1);
  assert.equal(f.calls.sessions[0].params.line_items[0].price_data.unit_amount, 999990);
  assert.equal('allow_promotion_codes' in f.calls.sessions[0].params, false);
  const data = JSON.parse(await readFile(f.file, 'utf8'));
  assert.deepEqual(data.surveys[0].ratings, ratings);
  assert.equal(data.surveys[0].comments, '');
  assert.equal(data.surveys[0].version, 3);
  assert.equal(data.surveys[0].tokenHash.includes(survey.surveyToken), false);
});

test('Puntuaciones altas, comentarios opcionales y validación de la respuesta', async () => {
  const f = fixture();
  assert.equal((await f.flow.submitSurvey(owner, { ...surveyBody(), ratings: Array(1).fill(5), comments: 'Todo claro' })).discount, 50000);
  for (const invalid of [[], Array(2).fill(3), Array(1).fill(0), Array(1).fill(6), Array(1).fill('3')]) {
    await assert.rejects(f.flow.submitSurvey(owner, { ...surveyBody(), ratings: invalid }));
  }
  await assert.rejects(f.flow.submitSurvey(owner, { ...surveyBody(), comments: 'x'.repeat(201) }));
});

test('Encuesta reenviada se registra una vez y no permite cambiar sus datos', async () => {
  const f = fixture(); const body = surveyBody();
  const first = await f.flow.submitSurvey(owner, body);
  const second = await f.flow.submitSurvey(owner, body);
  assert.equal(first.surveyToken, second.surveyToken);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).surveys.length, 1);
  await assert.rejects(f.flow.submitSurvey(owner, { ...body, ratings: Array(1).fill(5) }));
});

test('No permite descuento inventado, de otro navegador ni para un carrito alterado', async () => {
  const f = fixture(); const survey = await f.flow.submitSurvey(owner, surveyBody());
  for (const [visitor, token, selection] of [[owner, 'inventado', items], ['b'.repeat(64), survey.surveyToken, items],
    [owner, survey.surveyToken, [{ id: 2, quantity: 2 }]]]) {
    await assert.rejects(f.flow.checkout(visitor, { requestId: randomUUID(), items: selection, surveyToken: token }, 'http://localhost'));
  }
  assert.equal(f.calls.sessions.length, 0);
});

test('Doble clic, reintentos y segunda solicitud no duplican el descuento ni la sesión', async () => {
  const f = fixture(); const survey = await f.flow.submitSurvey(owner, surveyBody());
  const body = { requestId: randomUUID(), items, surveyToken: survey.surveyToken };
  const [a, b] = await Promise.all([f.flow.checkout(owner, body, 'http://localhost'), f.flow.checkout(owner, body, 'http://localhost')]);
  assert.equal(a.url, b.url);
  await f.flow.checkout(owner, body, 'http://localhost');
  assert.equal(f.calls.sessions.length, 1);
  assert.equal(f.calls.coupons.length, 1);
  await assert.rejects(f.flow.checkout(owner, { ...body, requestId: randomUUID() }, 'http://localhost'));
});

test('Fallo de Stripe conserva la encuesta y reutiliza las claves de idempotencia al reintentar', async () => {
  const f = fixture(); const survey = await f.flow.submitSurvey(owner, surveyBody());
  const create = f.stripe.checkout.sessions.create; const optionsSeen = [];
  f.stripe.checkout.sessions.create = async (params, options) => { optionsSeen.push(options.idempotencyKey); throw Error('offline'); };
  const body = { requestId: randomUUID(), items, surveyToken: survey.surveyToken };
  await assert.rejects(f.flow.checkout(owner, body, 'http://localhost'));
  f.stripe.checkout.sessions.create = async (params, options) => { optionsSeen.push(options.idempotencyKey); return create(params, options); };
  assert.equal((await f.flow.checkout(owner, body, 'http://localhost')).total, 949990);
  assert.equal(optionsSeen[0], optionsSeen[1]);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).surveys.length, 1);
});

test('Importe, moneda o modo de Stripe incorrectos impiden devolver la URL', async () => {
  for (const override of [{ amount_total: 1 }, { currency: 'usd' }, { livemode: true }, { total_details: { amount_discount: 5 } }]) {
    const f = fixture(override);
    await assert.rejects(f.flow.checkout(owner, { requestId: randomUUID(), items }, 'http://localhost'));
  }
});

test('Fallo del registro impide aplicar descuento', async () => {
  const flow = createPurchaseFlow({ products, store: { update: async () => { throw Error('disk unavailable'); } }, getStripe: () => null });
  await assert.rejects(flow.submitSurvey(owner, surveyBody()));
});

test('Regresión HTTP: páginas, contacto, contexto, validación, orígenes y bloqueo de producción', async t => {
  let app, purchaseFlow;
  try { ({ default: app, purchaseFlow } = await import('../src/server.js')); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Dependencias locales incompletas: requiere restauración autorizada.');
    return;
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/acercade', '/contacto', '/cancel', '/success']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.equal((await fetch(base + '/no-existe')).status, 404);
  const context = await fetch(base + '/purchase-context');
  const cookie = context.headers.get('set-cookie').split(';')[0];
  assert.match(context.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(context.headers.get('set-cookie'), /SameSite=Strict/i);
  const post = (path, body, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...extra }, body: JSON.stringify(body) });
  assert.equal((await post('/purchase-survey', surveyBody(), { Origin: 'https://other.example' })).status, 403);
  const survey = await post('/purchase-survey', surveyBody()); assert.equal(survey.status, 200);
  assert.equal((await survey.json()).discount, 50000);
  const invalidContact = await post('/contacto', {});
  assert.equal(invalidContact.status, 400);
  assert.deepEqual(Object.keys((await invalidContact.json()).errors), ['name', 'email', 'subject', 'message']);
  for (const message of ['bien', 'mal']) assert.equal((await post('/contacto', { name: 'Prueba', email: 'test@example.com', subject: 'Otro', message })).status, 201);
  assert.equal((await post('/contacto', { name: 'Prueba', email: 'test@example.com', subject: 'Consulta general', message: 'Mensaje exclusivo de prueba.' })).status, 201);
  process.env.STRIPE_SECRET_KEY = 'sk_live_dummy_not_a_credential';
  assert.equal((await post('/create-checkout-session', { requestId: randomUUID(), items })).status, 503);
  process.env.STRIPE_SECRET_KEY = '';
  const original = purchaseFlow.checkout;
  purchaseFlow.checkout = async () => ({ subtotal: 999990, discount: 0, total: 999990, url: 'https://checkout.stripe.com/test' });
  try { assert.equal((await post('/create-checkout-session', { requestId: randomUUID(), items })).status, 200); }
  finally { purchaseFlow.checkout = original; }
});

test('El SDK real serializa el descuento sin parámetros incompatibles (transporte local)', async t => {
  const { createServer } = await import('node:http');
  const { default: Stripe } = await import('stripe');
  const requests = [];
  const transport = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      requests.push({ path: req.url, params });
      res.setHeader('Content-Type', 'application/json');
      if (params.has('discounts[0][coupon]') && params.has('allow_promotion_codes')) {
        res.writeHead(400); res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Parámetros excluyentes' } })); return;
      }
      if (req.url === '/v1/coupons') {
        res.end(JSON.stringify({ id: 'coupon_wire', object: 'coupon', livemode: false, amount_off: 50000, currency: 'clp' }));
      } else {
        res.end(JSON.stringify({ id: 'cs_test_wire', object: 'checkout.session', status: 'open', livemode: false, currency: 'clp', amount_subtotal: 999990, amount_total: 949990, total_details: { amount_discount: 50000 }, url: 'https://checkout.stripe.com/c/pay/cs_test_wire' }));
      }
    });
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => transport.once('listening', resolve));
  t.after(() => new Promise(resolve => transport.close(resolve)));
  const stripe = new Stripe('sk_test_wire_dummy', { host: '127.0.0.1', port: transport.address().port, protocol: 'http', maxNetworkRetries: 0 });
  const flow = createPurchaseFlow({ products, store: createSurveyStore(join(runtime, 'wire.json')), getStripe: () => stripe });
  const survey = await flow.submitSurvey(owner, surveyBody());
  const result = await flow.checkout(owner, { requestId: randomUUID(), items, surveyToken: survey.surveyToken }, 'http://localhost');
  assert.equal(result.total, 949990);
  assert.equal(requests[0].params.get('amount_off'), '50000');
  assert.equal(requests[1].params.get('discounts[0][coupon]'), 'coupon_wire');
  assert.equal(requests[1].params.has('allow_promotion_codes'), false);
  assert.equal(requests[1].params.get('line_items[0][price_data][unit_amount]'), '999990');
});

test('El contacto no se duplica al reintentar el mismo envío', async () => {
  const { saveContact } = await import('../src/data/contact-storage.js');
  const before = JSON.parse(await readFile(process.env.CONTACT_FILE, 'utf8')).length;
  const contact = { id: Date.now(), requestId: randomUUID(), name: 'Prueba', email: 'idempotency@example.com', subject: 'Otro', message: 'bien' };
  await Promise.all([saveContact(contact), saveContact(contact)]);
  assert.equal(JSON.parse(await readFile(process.env.CONTACT_FILE, 'utf8')).length, before + 1);
  await assert.rejects(saveContact({ ...contact, message: 'mal' }), { code: 'CONTACT_REQUEST_CONFLICT' });
});
