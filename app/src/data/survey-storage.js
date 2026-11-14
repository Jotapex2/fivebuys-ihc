import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createSurveyStore(file) {
  let queue = Promise.resolve();
  return {
    update(operation) {
      const result = queue.then(async () => {
        let data;
        try { data = JSON.parse(await readFile(file, 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          data = { surveys: [], attempts: [] };
        }
        if (!Array.isArray(data.surveys) || !Array.isArray(data.attempts)) throw new Error('Registro de encuestas inválido.');
        const value = await operation(data);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, file);
        return value;
      });
      queue = result.catch(() => {});
      return result;
    }
  };
}
