import { tmpdir } from 'node:os';
// Herramienta de verificación externa: no añade Playwright a las dependencias del proyecto.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { products } from '../src/data/products.js';
import { createPurchaseFlow } from '../src/purchase-flow.js';
import { createSurveyStore } from '../src/data/survey-storage.js';

const { chromium } = createRequire(import.meta.url)(process.env.FIVEBUYS_PLAYWRIGHT_PATH || 'playwright');
const runtime = await mkdtemp(join(tmpdir(), 'fivebuys-browser-'));
process.env.DOTENV_CONFIG_PATH = 'NUL';
process.env.STRIPE_SECRET_KEY = '';
process.env.SURVEY_FILE = join(runtime, 'surveys.json');
process.env.CONTACT_FILE = join(runtime, 'contacts.json');
const { default: app, purchaseFlow } = await import('../src/server.js');
const sessions = new Map();
const coupons = new Map();
const calls = [];
let failStripe = false;
let stripeDelay = 0;
const stripe = {
  coupons: { async create(params, options) {
    const id = options.idempotencyKey;
    coupons.set(id, params.amount_off);
    return { id, livemode: false };
  } },
  checkout: { sessions: {
    async create(params, options) {
      if (stripeDelay) await new Promise(resolve => setTimeout(resolve, stripeDelay));
      if (failStripe) throw Error('Fallo simulado de conexión con Stripe');
      if ('discounts' in params && 'allow_promotion_codes' in params) throw Error('Stripe: parámetros excluyentes');
      if (sessions.has(options.idempotencyKey)) return sessions.get(options.idempotencyKey);
      const subtotal = params.line_items.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0);
      const discount = params.discounts ? coupons.get(params.discounts[0].coupon) : 0;
      const session = { id: `cs_test_${randomUUID()}`, livemode: false, status: 'open', currency: 'clp',
        amount_subtotal: subtotal, amount_total: subtotal - discount, total_details: { amount_discount: discount },
        url: 'https://checkout.stripe.com/c/pay/cs_test_browser' };
      sessions.set(options.idempotencyKey, session); sessions.set(session.id, session); calls.push(session);
      return session;
    },
    async retrieve(id) { return sessions.get(id); }
  } }
};
const flow = createPurchaseFlow({ products, store: createSurveyStore(process.env.SURVEY_FILE), getStripe: () => stripe });
purchaseFlow.checkout = flow.checkout;
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://checkout.stripe.com/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Stripe simulado para pruebas</h1>' });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const openCart = () => page.locator('.site-header [data-open-cart]').click();
  const openSurvey = () => page.locator('[data-survey-open]').click();
  const dialog = page.locator('[data-survey-dialog]');
  const settleSurvey = () => page.evaluate(() => Promise.all(document.querySelector('[data-survey-dialog]').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  const selectRating = (value = '1') => page.locator(`.purchase-question input[value="${value}"]`).check();
  const card = page.locator('[data-product-card][data-product-id="2"]');
  const postSurvey = () => page.getByRole('button', { name: 'Enviar y obtener 5 %', exact: true }).click();
  const ready = () => page.waitForFunction(() => document.querySelector('[data-survey-dialog]')?.open && document.querySelector('[data-survey-countdown]')?.hidden === false && document.querySelector('[data-survey-now]')?.hidden === false);

  await page.goto(base);
  const nameSession = await context.newCDPSession(page);
  await nameSession.send('Accessibility.enable');
  const readableNodes = async () => (await nameSession.send('Accessibility.getFullAXTree')).nodes.filter(node => !node.ignored);
  const catalogAX = await readableNodes();
  check(await page.locator('.site-header').getByRole('button', { name: 'Carrito', exact: true }).count() === 1, 'El icono de cabecera se llama solamente Carrito');
  check(await page.locator('.site-header').getByRole('link', { name: 'Nosotros', exact: true }).count() === 1, 'Nosotros conserva su nombre visible sin instrucciones adicionales');
  check(catalogAX.some(node => node.role?.value === 'StaticText' && node.name?.value === '999.990 pesos chilenos'), 'El catálogo expone el precio con moneda chilena explícita');
  check(!catalogAX.some(node => /\$\s*[0-9]/.test(node.name?.value || '')), 'El símbolo dólar visual no se anuncia en el árbol accesible del catálogo');
  check(catalogAX.filter(node => node.role?.value === 'article' && products.some(product => product.name === node.name?.value)).length === 9, 'Los nueve productos tienen nombre de artículo asociado a su título');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement.matches('.skip-link')), 'El primer Tab ofrece saltar al contenido');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement.id === 'contenido-principal'), 'El atajo lleva el foco al contenido principal');
  await page.screenshot({ path: join(runtime, 'catalogo.png') });
  check(await page.locator('[data-product-card]').count() === 9, 'Se conservan los nueve productos');
  check(await page.locator('[data-qty-catalog-display]').count() === 9, 'Los nueve contadores aparecen desde cero');
  check(!await page.locator('.site-header [data-open-cart]').innerText().then(text => text.includes('Carrito')), 'La cabecera utiliza un icono de carrito');
  const minusBox = await card.locator('[data-qty-decrease]').boundingBox();
  const plusBox = await card.locator('[data-add-product]').boundingBox();
  check(minusBox.x < plusBox.x && Math.abs(minusBox.y - plusBox.y) < 2, 'El contador del catálogo es horizontal');
  await page.locator('[data-search]').fill('Ryzen');
  const found = await page.locator('[data-product-card]:visible').count();
  check(found > 0 && found < 9, 'La búsqueda filtra el catálogo');
  await page.locator('[data-search]').fill('');
  await card.locator('[data-add-product]').click();
  check(await card.locator('[data-qty-catalog-display]').innerText() === '1', 'Aumentar desde cero añade exactamente una unidad');
  check(await page.evaluate(() => document.activeElement.matches('[data-add-product="2"]')), 'El contador del catálogo conserva el foco');
  await card.screenshot({ path: join(runtime, 'catalog-card.png') });
  await card.getByRole('button', { name: 'Carrito', exact: true }).click();
  check(await page.locator('[data-cart-view]').isVisible() && page.url().endsWith('#carrito'), 'El icono junto al contador abre el carrito');
  check(await page.locator('[data-cart-total] [data-money-visible]').innerText() === '$999.990', 'El carrito empieza sin descuento');
  await page.evaluate(() => window.previousQuantityButton = document.querySelector('[data-quantity="1"]'));
  await page.locator('[data-quantity="1"]').click();
  check(await page.locator('[data-cart-total] [data-money-visible]').innerText() === '$1.999.980', 'Cambiar cantidad conserva los precios originales');
  check((await readableNodes()).some(node => node.role?.value === 'StaticText' && node.name?.value === '1.999.980 pesos chilenos'), 'La lectura del total se actualiza en pesos al cambiar cantidades');
  check(await page.evaluate(() => document.activeElement === window.previousQuantityButton), 'Cambiar cantidad conserva el mismo control y su foco');
  await page.locator('[data-quantity="-1"]').click();
  await page.reload();
  check(await page.locator('[data-cart-view]').isVisible(), 'Recargar conserva la vista del carrito');
  check(await page.locator('[data-cart-total] [data-money-visible]').innerText() === '$999.990', 'Productos y cantidades persisten');
  await page.locator('[data-cart-view]').screenshot({ path: join(runtime, 'carrito.png') });

  // La instantánea DOM por sí sola no detecta descendientes ocultos por inert.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  stripeDelay = 1600;
  await page.getByRole('button', { name: 'Ir a pagar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-checkout-status]').textContent === 'Preparando pago…');
  const pendingAX = (await cdp.send('Accessibility.getFullAXTree')).nodes.filter(node => !node.ignored);
  check(pendingAX.some(node => node.role?.value === 'heading' && node.name?.value === 'Tu carrito'), 'El árbol accesible real conserva el carrito durante la espera');
  check(pendingAX.some(node => node.role?.value === 'button' && node.name?.value === 'Preparando pago…'), 'El lector conserva el nombre del botón de pago mientras está deshabilitado');
  check(pendingAX.some(node => node.role?.value === 'StaticText' && node.name?.value === 'Preparando pago…'), 'El estado de preparación llega al árbol accesible real');
  check(await page.locator('[data-cart-items] button:not(:disabled), [data-clear-cart]:not(:disabled)').count() === 0, 'La espera bloquea cambios de cantidades y vaciado sin ocultar el contenido');
  await page.waitForURL('https://checkout.stripe.com/**');
  stripeDelay = 0;
  check(calls.at(-1).amount_total === 999990 && calls.at(-1).total_details.amount_discount === 0, 'Compra normal: importe completo sin descuento');
  await page.goto(base + '/cancel');
  await page.getByRole('link', { name: 'Volver al carrito' }).click();
  await page.locator('[data-cart-view]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-cart-total] [data-money-visible]')?.textContent === '$999.990');
  check(await page.locator('[data-cart-view]').isVisible() && await page.locator('[data-cart-total] [data-money-visible]').innerText() === '$999.990', 'Cancelar devuelve directamente al carrito conservado');
  check(await page.locator('[data-clear-cart]').isEnabled() && await page.locator('[data-quantity="1"]').isEnabled(), 'Los controles vuelven a estar disponibles al regresar');
  await page.goto(base + '/acercade');
  check(await page.locator('[data-cart-count]').innerText() === '1', 'La cabecera secundaria refleja la selección');
  check((await page.locator('main').innerText()).includes('Interacción Humano-Computador'), 'Acerca de se refiere al curso de IHC');
  check(await page.getByRole('link', { name: 'Nosotros', exact: true }).count() >= 1, 'La navegación presenta Nosotros sin cambiar la ruta');
  const aboutSummary = page.locator('.about-details summary').first();
  await aboutSummary.focus(); await page.keyboard.press('Enter');
  check(await aboutSummary.evaluate(el => el.parentElement.open), 'Los detalles de Nosotros se abren con teclado');
  check(await aboutSummary.locator('.interaction-wave').count() === 1, 'La activación por teclado produce una onda decorativa');
  await page.screenshot({ path: join(runtime, 'nosotros.png'), fullPage: true });

  await page.locator('[data-open-cart]').click();
  await page.locator('[data-cart-view]').waitFor({ state: 'visible' });
  check(await page.locator('[data-cart-view]').isVisible(), 'El carrito también abre desde otra página');

  await openSurvey(); await settleSurvey();
  check(await page.locator('.purchase-question').count() === 1, 'La encuesta tiene una sola pregunta');
  check((await page.locator('#survey-intro').innerText()).includes('Selecciona de 1 a 5 estrellas'), 'La encuesta indica directamente cómo responder');
  check(await dialog.getByRole('radio').count() === 5, 'Cinco opciones nativas con nombre accesible');
  check(await dialog.getByRole('radio', { name: '4 de 5 estrellas', exact: true }).count() === 1, 'Cada estrella identifica su puntuación para lectura accesible');
  check(await dialog.locator('input:checked').count() === 0 && await dialog.locator('[data-filled="true"]').count() === 0, 'Las estrellas empiezan vacías');
  await dialog.locator('[data-star-value="3"]').hover();
  check(await dialog.locator('[data-filled="true"]').count() === 3 && await dialog.locator('input:checked').count() === 0, 'Hover previsualiza tres sin seleccionar');
  await page.locator('#survey-title').hover();
  check(await dialog.locator('[data-filled="true"]').count() === 0, 'Salir del hover restaura el estado vacío');
  await selectRating('3');
  await dialog.locator('[data-star-value="5"]').hover();
  check(await dialog.locator('[data-filled="true"]').count() === 5 && await dialog.locator('input:checked').inputValue() === '3', 'La previsualización no cambia la respuesta guardada');
  await page.locator('#survey-title').hover();
  check(await dialog.locator('[data-filled="true"]').count() === 3, 'Salir del hover recupera la selección');
  await dialog.locator('input:checked').focus(); await page.keyboard.press('ArrowRight');
  check(await dialog.locator('input:checked').inputValue() === '4', 'Las flechas permiten seleccionar con teclado');
  await page.evaluate(() => document.querySelectorAll('.purchase-question input').forEach(input => input.checked = false));
  await postSurvey();
  check(await page.evaluate(() => document.activeElement.name) === 'rating-0', 'La validación lleva el foco a la pregunta incompleta');
  check(await dialog.locator('[data-rating-error]').isVisible(), 'Error breve asociado a la pregunta');
  await page.keyboard.press('Space');
  check(await dialog.locator('input:checked').count() === 1, 'Espacio selecciona una estrella');
  await page.getByRole('button', { name: 'Volver al carrito', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  check(await page.evaluate(() => document.activeElement.matches('[data-survey-open]')), 'Volver devuelve el foco al botón de apertura');
  await openSurvey(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check(!await dialog.isVisible(), 'Escape permite salir');
  await openSurvey(); await page.getByRole('button', { name: 'Cerrar', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  check(!await dialog.isVisible(), 'La X permite salir');

  await openSurvey();
  stripeDelay = 800;
  await page.getByRole('button', { name: 'Continuar sin descuento', exact: true }).click();
  check(await page.locator('[data-survey-skip]').getAttribute('aria-disabled') === 'true', 'La espera de Stripe impide repetir la acción');
  check((await page.locator('[data-survey-status]').innerText()).includes('Estamos conectando'), 'La espera ofrece una guía breve y visible');
  await page.waitForURL('https://checkout.stripe.com/**');
  stripeDelay = 0;
  check(calls.at(-1).amount_total === 999990, 'Omitir la encuesta conserva el precio normal');
  check(JSON.parse(await readFile(process.env.SURVEY_FILE, 'utf8')).surveys.length === 0, 'Omitir no registra respuestas');
  await page.goto(base + '/#carrito'); await openSurvey(); await selectRating();
  await page.locator('#survey-comments').fill('Podría ser más claro.');
  failStripe = true; await postSurvey();
  await page.locator('[data-survey-retry]').waitFor({ state: 'visible' });
  check(!await page.locator('[data-survey-heading]').isVisible() && !await page.locator('[data-survey-form]').isVisible(), 'La confirmación no repite la pregunta ni su introducción');
  check((await dialog.ariaSnapshot()).includes('Encuesta registrada'), 'El diálogo tiene nombre de confirmación accesible');
  check(!await page.locator('[data-survey-now]').isVisible() && !await page.locator('[data-survey-pause]').isVisible(), 'No se anuncia una cuenta atrás si Stripe falla');
  check((await page.locator('[data-survey-status]').innerText()).length < 100, 'El error no repite instrucciones largas');
  const beforeRetry = JSON.parse(await readFile(process.env.SURVEY_FILE, 'utf8')).surveys.length;
  failStripe = false; await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await ready();
  check(JSON.parse(await readFile(process.env.SURVEY_FILE, 'utf8')).surveys.length === beforeRetry, 'Reintentar no duplica la encuesta');
  check(await page.locator('[data-survey-total] [data-money-visible]').innerText() === '$949.990 CLP', 'El total actualizado es 949.990 CLP');
  const discountedAX = await readableNodes();
  check(discountedAX.some(node => node.role?.value === 'StaticText' && node.name?.value === '949.990 pesos chilenos') && discountedAX.some(node => node.role?.value === 'StaticText' && node.name?.value === 'menos 50.000 pesos chilenos'), 'Encuesta y descuento exponen importes en pesos chilenos');
  check(!discountedAX.some(node => /\$\s*[0-9]/.test(node.name?.value || '')), 'La confirmación no entrega símbolos de dólar al lector');
  check(calls.at(-1).amount_total === 949990 && calls.at(-1).total_details.amount_discount === 50000, 'Coinciden el descuento y el importe de la sesión de Stripe simulada');
  await page.waitForFunction(() => Number(document.querySelector('[data-survey-seconds]').textContent) <= 9);
  check(await page.locator('[data-survey-countdown]').isVisible(), 'El contador visible empieza solo con sesión válida');
  check(await page.locator('[data-survey-countdown]').getAttribute('aria-live') === 'off', 'El contador no anuncia cada segundo');
  check(await page.locator('[data-survey-seconds]').innerText() !== '10', 'Los segundos restantes se actualizan');
  await page.waitForFunction(() => document.querySelector('[data-survey-status]').textContent.includes('Quedan 5 segundos'));
  check((await page.locator('[data-survey-status]').innerText()).includes('Quedan 5 segundos'), 'El lector recibe un aviso intermedio breve');
  await settleSurvey(); await dialog.screenshot({ path: join(runtime, 'survey-success.png') });
  await page.getByRole('button', { name: 'Pausar', exact: true }).click(); await page.waitForTimeout(10500);
  check(page.url().startsWith(base), 'Pausar detiene la redirección sin perder el descuento');
  check(!await page.locator('[data-survey-countdown]').isVisible(), 'Pausar oculta el contador y conserva Continuar');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await page.waitForURL('https://checkout.stripe.com/**');
  check(calls.at(-1).amount_total === 949990, 'Continuar utiliza la sesión descontada ya preparada');
  await page.goto(base + '/#carrito'); await openSurvey(); await selectRating(); await postSurvey(); await ready();
  await page.waitForURL('https://checkout.stripe.com/**', { timeout: 15000 });
  check(calls.at(-1).amount_total === 949990, 'La redirección automática funciona cuando Stripe está listo');

  await page.goto(base + '/#carrito');
  await page.locator('[data-remove="2"]').click();
  check(await page.locator('[data-checkout]').isDisabled() && await page.locator('[data-survey-open]').isDisabled(), 'Eliminar el último producto deshabilita ambos pagos');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-survey-open]')).backgroundColor === 'rgb(229, 229, 235)');
  check(await page.locator('[data-survey-open]').evaluate(button => getComputedStyle(button).backgroundColor) === 'rgb(229, 229, 235)', 'El estado deshabilitado también es visible');
  await page.locator('[data-clear-cart]').click();
  check(await page.locator('[data-checkout-status]').innerText() === 'El carrito ya está vacío.', 'Vaciar un carrito vacío ofrece retroalimentación');
  await page.locator('[data-show-catalog]').click();
  await page.locator('[data-add-product="1"]').click(); await page.locator('[data-add-product="2"]').click();
  await openCart(); await page.locator('[data-clear-cart]').click();
  check(await page.locator('[data-checkout-status]').innerText() === 'Carrito vaciado.' && await page.locator('[data-cart-count]').innerText() === '0', 'Vaciar confirma y sincroniza los contadores');

  await page.goto(base);
  const homeContact = await page.locator('.contact-intro').innerText();
  await page.goto(base + '/contacto');
  check(await page.locator('.contact-intro').innerText() === homeContact, 'Inicio y Contacto comparten el mismo contenido');
  check(await page.locator('select[name="subject"] option').allTextContents().then(options => options.includes('Otro')), 'El asunto incluye Otro');
  check(await page.getByLabel('Nombre completo').getAttribute('autocomplete') === 'name' && await page.getByLabel('Correo electrónico').getAttribute('autocomplete') === 'email', 'Nombre y correo permiten autocompletado');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  check(await page.evaluate(() => document.activeElement.id) === 'contact-name', 'El primer error de contacto recibe foco');
  await page.getByLabel('Nombre completo').fill('Prueba'); await page.getByLabel('Correo electrónico').fill('prueba@');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  check(await page.evaluate(() => document.activeElement.id) === 'contact-email' && await page.locator('#contact-email-error').innerText() === 'Revisa el correo.', 'El error identifica el correo sin una explicación extensa');
  await page.evaluate(() => {
    window.contactAnnouncements = [];
    new MutationObserver(() => { const text = document.querySelector('[data-form-response]').textContent; if (text) window.contactAnnouncements.push(text); }).observe(document.querySelector('[data-form-response]'), { childList: true, subtree: true });
  });
  await page.getByLabel('Correo electrónico').fill('browser@example.com');
  check(await page.evaluate(() => window.contactAnnouncements.length) === 0, 'Escribir el correo no genera anuncios de estado');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  check(await page.evaluate(() => document.activeElement.id) === 'contact-subject', 'El asunto obligatorio tiene un error específico');
  await page.getByLabel('Asunto').selectOption({ label: 'Otro' }); await page.getByLabel('Mensaje', { exact: true }).fill('bien');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-form-response]').textContent === 'Mensaje enviado.');
  check(await page.getByLabel('Mensaje', { exact: true }).inputValue() === 'bien', 'Enviar conserva el texto y acepta un mensaje de cuatro caracteres');
  check(await page.locator('[data-form-response]').evaluate(element => element.classList.contains('success')), 'Confirmación de éxito visible y accesible');
  const contactCount = JSON.parse(await readFile(process.env.CONTACT_FILE, 'utf8')).length;
  await page.locator('[data-contact-form]').evaluate(form => form.requestSubmit());
  check(JSON.parse(await readFile(process.env.CONTACT_FILE, 'utf8')).length === contactCount, 'Un envío ya confirmado no se repite accidentalmente');
  await page.locator('[data-form-response]').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await page.locator('[data-contact-form]').screenshot({ path: join(runtime, 'contact-success.png') });
  await page.locator('[data-contact-new]').click();
  check(await page.getByLabel('Mensaje', { exact: true }).inputValue() === '' && await page.evaluate(() => document.activeElement.id) === 'contact-name', 'Solo Escribir otro limpia el formulario y restaura el foco');
  await page.getByLabel('Nombre completo').fill('Prueba'); await page.getByLabel('Correo electrónico').fill('browser@example.com');
  await page.getByLabel('Asunto').selectOption({ label: 'Otro' }); await page.getByLabel('Mensaje', { exact: true }).fill('mal');
  await page.route('**/contacto', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-form-response]').textContent === 'Sin conexión. Reintenta.');
  check(await page.getByLabel('Mensaje', { exact: true }).inputValue() === 'mal', 'Una respuesta perdida conserva el texto');
  const persistedAfterLostResponse = JSON.parse(await readFile(process.env.CONTACT_FILE, 'utf8')).length;
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-form-response]').textContent === 'Mensaje enviado.');
  check(JSON.parse(await readFile(process.env.CONTACT_FILE, 'utf8')).length === persistedAfterLostResponse, 'Reintentar tras perder la respuesta no duplica el contacto');

  await page.goto(base);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator('.menu-button').click();
  check(await page.evaluate(() => document.querySelector('.mobile-menu').getAnimations().some(animation => animation.effect.getTiming().duration === 350)), 'El menú entra en 350 ms también en tableta');
  await page.locator('.menu-button').click();
  check(await page.evaluate(() => document.querySelector('.mobile-menu').getAnimations().some(animation => animation.effect.getTiming().duration === 250)), 'El menú sale en 250 ms');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.mobile-menu')).display === 'none');
  await page.locator('.menu-button').click();
  await page.keyboard.press('Escape');
  check(await page.locator('.menu-button').getAttribute('aria-expanded') === 'false', 'Escape cierra el menú móvil');
  check(await page.evaluate(() => document.activeElement.matches('.menu-button') && document.querySelector('.mobile-menu').inert), 'El menú cerrado no retiene foco ni enlaces accesibles');

  await page.locator('[data-add-product="2"]').click(); await openCart(); await openSurvey(); await settleSurvey();
  await dialog.screenshot({ path: join(runtime, 'survey-empty.png') });
  await page.setViewportSize({ width: 320, height: 800 });
  check(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth), 'La encuesta no desborda horizontalmente a 320 px');
  check(await dialog.evaluate(d => d.scrollHeight <= d.clientHeight), 'La encuesta cabe en móvil con texto normal');
  await page.screenshot({ path: join(runtime, 'survey-mobile.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  check(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth), 'Texto al 200 % sin recortes horizontales');
  await page.screenshot({ path: join(runtime, 'survey-text-200.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await openSurvey();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check(await dialog.evaluate(d => d.getAnimations().length === 0), 'Movimiento reducido omite las transiciones del diálogo');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check(await page.getByRole('columnheader').count() === 5, 'Las cinco cabeceras del carrito siguen accesibles a 320 px');
  check((await page.getByRole('table', { name: 'Computadores en tu carrito' }).ariaSnapshot()).includes('columnheader'), 'La tabla móvil conserva su nombre y estructura accesible');
  for (const path of ['/', '/contacto', '/acercade', '/#carrito']) {
    await page.goto(base + path);
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    // Medir después de aplicar el cambio de tamaño y las transiciones reducidas.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed').map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })).slice(0, 12) }));
    if (overflow.scroll > overflow.width) console.log('Diagnóstico reflujo', path, JSON.stringify(overflow));
    check(overflow.scroll <= overflow.width, 'Reflujo a 320 px y texto 200 %: ' + path);
  }
  await page.goto(base + '/acercade');
  await page.locator('.about-details summary').first().focus(); await page.keyboard.press('Enter');
  check(await page.locator('.interaction-wave').count() === 0, 'Movimiento reducido omite las ondas');
  await page.goto(base + '/success');
  check(await page.locator('.payment-success-mark').evaluate(el => getComputedStyle(el).color === 'rgb(22, 101, 52)'), 'La marca de éxito se presenta en verde');
  await page.screenshot({ path: join(runtime, 'pago-presentacion.png'), fullPage: true });
  // Este recorrido comprueba presentación, no verifica un pago (F02 pendiente).
  for (const route of ['/', '/#carrito', '/contacto', '/acercade', '/cancel', '/success', '/pagina-inexistente']) {
    await page.goto(base + route);
    const ax = await page.locator('main').ariaSnapshot();
    check(ax.includes('main'), 'La región principal está expuesta al lector: ' + route);
    const semantics = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      const brokenRefs = [...document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls],label[for]')].flatMap(el => ['aria-labelledby','aria-describedby','aria-controls','for'].flatMap(attr => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).filter(id => !document.getElementById(id))));
      const fields = [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(el => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map(el => el.name);
      const missingAlts = document.querySelectorAll('img:not([alt])').length;
      const visibleH1 = [...document.querySelectorAll('h1')].filter(el => el.checkVisibility()).length;
      return { duplicates, brokenRefs, fields, missingAlts, visibleH1, lang: document.documentElement.lang };
    });
    check(semantics.duplicates.length === 0 && semantics.brokenRefs.length === 0, 'Identificadores y referencias ARIA válidos: ' + route);
    check(semantics.fields.length === 0 && semantics.missingAlts === 0, 'Campos etiquetados e imágenes con atributo alternativo: ' + route);
    check(semantics.lang === 'es' && semantics.visibleH1 === 1, 'Idioma y título principal visible: ' + route);
    if (route === '/acercade') check(!(await page.locator('main').innerText()).includes('Desarrollo Web y Mobile'), 'Nosotros no menciona el ramo anterior');
  }
  check(errors.length === 0, 'No hay errores de JavaScript en los recorridos');
  console.log(JSON.stringify({ checks, result: 'PASS', stripe: 'SDK validado con transporte local; pagos simulados, sin cobros', screenshots: runtime }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
