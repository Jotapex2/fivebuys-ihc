import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { products } from './data/products.js';
import { saveContact } from './data/contact-storage.js';
import { randomBytes } from 'node:crypto';
import { createSurveyStore } from './data/survey-storage.js';
import { surveyQuestions, PurchaseError } from './data/checkout-totals.js';
import { createPurchaseFlow } from './purchase-flow.js';


const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

let stripeClient;

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey || !/^(sk|rk)_test_/.test(secretKey)) {
    return null;
  }

  stripeClient ??= new Stripe(secretKey);
  return stripeClient;
}

app.set('views', join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index', {
    title: 'FiveBuys - Computadores',
    products,
    surveyQuestions,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

app.get('/acercade', (req, res) => {
  res.render('acercade', { title: 'Nosotros | FiveBuys' });
});

app.get('/contacto', (req, res) => {
  res.render('contacto', { title: 'Contacto | FiveBuys' });
});

app.post('/contacto', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  const requestId = req.body.requestId;

  const errors = {};
  if (name.length < 3) errors.name = 'Nombre: al menos 3 caracteres.';
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = email ? 'Revisa el correo.' : 'Escribe tu correo.';
  if (!subject) errors.subject = 'Selecciona un asunto.';
  if (!message) errors.message = 'Escribe tu mensaje.';
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId))) {
    return res.status(400).json({ ok: false, message: 'No se pudo identificar el envío. Reintenta.' });
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, message: 'Revisa los campos marcados.', errors });
  }

  const contact = {
    id: Date.now(),
    ...(requestId ? { requestId } : {}),
    name,
    email,
    subject,
    message,
    createdAt: new Date().toISOString()
  };

  try {
    await saveContact(contact);
    return res.status(201).json({ ok: true, message: 'Mensaje enviado.' });
  } catch (error) {
    if (error.code === 'CONTACT_REQUEST_CONFLICT') return res.status(409).json({ ok: false, message: 'El mensaje cambió. Vuelve a enviarlo.' });
    console.error('No fue posible guardar el contacto:', error);
    return res.status(500).json({ ok: false, message: 'No fue posible guardar el mensaje.' });
  }
});

const productsById = new Map(products.map((p) => [p.id, p]));

export const purchaseFlow = createPurchaseFlow({
  products, getStripe: getStripeClient,
  store: createSurveyStore(process.env.SURVEY_FILE || join(__dirname, '..', 'storage', 'encuestas.json'))
});

function purchaseOwner(req) {
  return (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('fivebuys_purchase='))?.slice('fivebuys_purchase='.length);
}

app.get('/purchase-context', (req, res) => {
  if (!/^[0-9a-f]{64}$/.test(purchaseOwner(req) || '')) {
    res.cookie('fivebuys_purchase', randomBytes(32).toString('hex'), {
      httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 86400000, path: '/'
    });
  }
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

function purchaseEndpoint(action) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const origin = req.protocol + '://' + req.get('host');
      if ((req.get('origin') && req.get('origin') !== origin) || req.get('sec-fetch-site') === 'cross-site') {
        throw new PurchaseError('La solicitud debe realizarse desde FiveBuys.', 403);
      }
      if (!req.is('application/json')) throw new PurchaseError('La solicitud debe enviarse en formato JSON.', 415);
      const result = action === 'survey'
        ? await purchaseFlow.submitSurvey(purchaseOwner(req), req.body)
        : await purchaseFlow.checkout(purchaseOwner(req), req.body, origin);
      res.json(result);
    } catch (error) {
      if (!(error instanceof PurchaseError)) {
        const diagnostic = {};
        for (const field of ['type', 'code', 'param', 'requestId']) {
          if (typeof error[field] === 'string' && /^[a-zA-Z0-9_\[\].-]{1,100}$/.test(error[field]) && !/^(sk|rk|pk)_/.test(error[field])) diagnostic[field] = error[field];
        }
        console.warn('FiveBuys: error de pago', diagnostic);
      }
      res.status(error instanceof PurchaseError ? error.status : 503).json({
        error: error instanceof PurchaseError ? error.message : 'No pudimos abrir el pago. Reintenta.'
      });
    }
  };
}

app.post('/purchase-survey', purchaseEndpoint('survey'));
app.post('/create-checkout-session', purchaseEndpoint('checkout'));

app.get('/success', (req, res) => {
  res.render('success', { title: 'Pago exitoso | FiveBuys' });
});

app.get('/cancel', (req, res) => {
  res.render('cancel', { title: 'Pago cancelado | FiveBuys' });
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Pagina no encontrada | FiveBuys' });
});

const port = Number(process.env.PORT) || 3000;

function listenOnAvailablePort(selectedPort, attemptsLeft = 10) {
  const server = app.listen(selectedPort, () => {
    console.log(`FiveBuys disponible en http://localhost:${selectedPort}`);
  });

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const nextPort = selectedPort + 1;
      console.warn(`El puerto ${selectedPort} esta ocupado. Intentando con el puerto ${nextPort}...`);
      listenOnAvailablePort(nextPort, attemptsLeft - 1);
      return;
    }

    console.error('No fue posible iniciar FiveBuys:', error.message);
    process.exitCode = 1;
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  listenOnAvailablePort(port);
}

export default app;
