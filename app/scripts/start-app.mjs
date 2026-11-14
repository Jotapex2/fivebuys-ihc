import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

// Importar este módulo para probarlo no abre archivos de configuración.
export function parseTestConfig(text) {
  const assignments = text.split(/\r?\n/).filter(line => /^\s*(?:export\s+)?STRIPE_SECRET_KEY\s*=/.test(line));
  if (assignments.length === 0) throw new Error('No se reconoce STRIPE_SECRET_KEY. Usa una línea con el formato STRIPE_SECRET_KEY=sk_test_ seguido de tu clave.');
  if (assignments.length > 1) throw new Error('Deja una sola línea STRIPE_SECRET_KEY en el archivo env.');
  const values = dotenv.parse(text);
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(values.STRIPE_SECRET_KEY || '')) {
    throw new Error('La clave secreta debe comenzar con sk_test_. Usa el entorno de pruebas de Stripe.');
  }
  if (values.STRIPE_PUBLISHABLE_KEY && !/^pk_test_[A-Za-z0-9_]+$/.test(values.STRIPE_PUBLISHABLE_KEY)) {
    throw new Error('La clave publicable, si la incluyes, debe comenzar con pk_test_.');
  }
  return { secretKey: values.STRIPE_SECRET_KEY, publicKey: values.STRIPE_PUBLISHABLE_KEY || '' };
}

// Admitir los formatos de texto habituales de Windows sin modificar el archivo.
export function decodeTestConfig(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = Buffer.from(bytes.subarray(2));
    if (body.length % 2) throw new Error('El archivo de configuración está incompleto. Guárdalo de nuevo como UTF-8.');
    return body.swap16().toString('utf16le');
  }
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

export function loadTestConfig(configPath) {
  if (!existsSync(configPath)) throw new Error('No se encontró env. Sigue el paso Configurar Stripe del README.');
  return parseTestConfig(decodeTestConfig(readFileSync(configPath)));
}

export async function startApp({ configPath, port = 3001 } = {}) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const deliveryRoot = resolve(appRoot, '..');
  if (!configPath) {
    const plain = join(deliveryRoot, 'env');
    const dotted = join(deliveryRoot, '.env');
    if (existsSync(plain) && existsSync(dotted)) throw new Error('Hay dos archivos de configuración. Deja uno solo: env o .env.');
    configPath = existsSync(plain) ? plain : dotted;
  }
  const config = loadTestConfig(configPath);
  process.env.STRIPE_SECRET_KEY = config.secretKey;
  process.env.STRIPE_PUBLISHABLE_KEY = config.publicKey;
  process.env.DOTENV_CONFIG_PATH = 'NUL';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const { default: app } = await import('../src/server.js');
  return new Promise((resolveServer, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolveServer(server));
    server.once('error', () => reject(new Error('El puerto está ocupado. Cierra esta ventana y vuelve a abrir INICIAR-APP.')));
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  startApp({ port: Number(process.env.PORT) || 3001 }).then(server => {
    console.log(`FiveBuys: http://127.0.0.1:${server.address().port}`);
    console.log('Para cerrar la aplicación, pulsa Ctrl+C en esta ventana.');
  }).catch(error => {
    // Solo mensajes de validación controlados; nunca imprimir valores de claves.
    console.error(error.message);
    process.exitCode = 1;
  });
}
