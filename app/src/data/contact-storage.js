import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultFile = join(projectRoot, 'storage', 'contactos.json');
let writeQueue = Promise.resolve();

async function readContacts(file) {
  try {
    const contents = await readFile(file, 'utf8');
    const contacts = JSON.parse(contents);
    return Array.isArray(contacts) ? contacts : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function saveContact(contact) {
  const file = process.env.CONTACT_FILE || defaultFile;

  const write = writeQueue.then(async () => {
    await mkdir(dirname(file), { recursive: true });
    const contacts = await readContacts(file);
    if (contact.requestId) {
      const existing = contacts.find(entry => entry.requestId === contact.requestId);
      if (existing) {
        if (['name', 'email', 'subject', 'message'].some(field => existing[field] !== contact[field])) {
          const error = new Error('Solicitud de contacto reutilizada con otros datos.');
          error.code = 'CONTACT_REQUEST_CONFLICT';
          throw error;
        }
        return;
      }
    }
    contacts.push(contact);
    await writeFile(file, `${JSON.stringify(contacts, null, 2)}\n`, 'utf8');
  });

  writeQueue = write.catch(() => {});
  return write;
}
