import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTestConfig, decodeTestConfig, loadTestConfig, startApp } from '../scripts/start-app.mjs';

process.env.DOTENV_CONFIG_PATH = 'NUL';
process.env.STRIPE_SECRET_KEY = '';
const valid = 'STRIPE_SECRET_KEY=sk_test_fixture_123\nSTRIPE_PUBLISHABLE_KEY=pk_test_fixture_123\n';

test('Acepta una única clave secreta de pruebas y la publicable es opcional', () => {
  assert.equal(parseTestConfig(valid).publicKey, 'pk_test_fixture_123');
  assert.equal(parseTestConfig('STRIPE_SECRET_KEY="sk_test_fixture" # ejemplo').publicKey, '');
});

test('Rechaza claves de producción, vacías y múltiples sin revelar sus valores', () => {
  for (const text of ['', 'STRIPE_SECRET_KEY=', 'STRIPE_SECRET_KEY=sk_live_fixture',
    `${valid}STRIPE_SECRET_KEY=sk_test_second`, 'STRIPE_SECRET_KEY=pk_test_fixture',
    `${valid}STRIPE_PUBLISHABLE_KEY=pk_live_fixture`]) {
    assert.throws(() => parseTestConfig(text), error => !error.message.includes('fixture'));
  }
});

test('Informa un archivo ausente y arranca desde una configuración sintética', async () => {
  const runtime = await mkdtemp(join(tmpdir(), 'fivebuys-startup-'));
  const configPath = join(runtime, 'configuracion-sintetica.txt');
  assert.throws(() => loadTestConfig(configPath), /No se encontró/);
  await writeFile(configPath, valid);
  process.env.CONTACT_FILE = join(runtime, 'contactos.json');
  process.env.SURVEY_FILE = join(runtime, 'encuestas.json');
  const server = await startApp({ configPath, port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes('Juan González, Manuel Latorre, Isabel Marín, Francisco Ocares'));
    assert.equal(html.split('class="purchase-question"').length - 1, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    process.env.STRIPE_SECRET_KEY = '';
  }
});


test('Admite UTF-8 y UTF-16 de Windows sin cambiar los valores', async () => {
  const utf16 = Buffer.from(valid, 'utf16le');
  const bigEndian = Buffer.from(utf16).swap16();
  const variants = [Buffer.from(valid), Buffer.from('\uFEFF' + valid),
    Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]),
    Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])];
  const runtime = await mkdtemp(join(tmpdir(), 'fivebuys-encoding-'));
  for (let i = 0; i < variants.length; i++) {
    assert.equal(parseTestConfig(decodeTestConfig(variants[i])).secretKey, 'sk_test_fixture_123');
    const path = join(runtime, `configuracion-sintetica-${i}.txt`);
    await writeFile(path, variants[i]);
    assert.equal(loadTestConfig(path).secretKey, 'sk_test_fixture_123');
  }
});

test('Distingue una línea ausente de claves repetidas sin revelar datos', () => {
  assert.throws(() => parseTestConfig('sk_test_fixture'), /No se reconoce STRIPE_SECRET_KEY/);
  assert.throws(() => parseTestConfig(valid + valid), /Deja una sola línea/);
});
