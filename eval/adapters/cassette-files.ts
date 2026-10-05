import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Cassette, cassetteSchema, emptyCassette } from '../../src/core/ai/cassette';

/** Cassettes live in eval/cassettes/<name>.json and are committed (they hold no secrets). */
export const CASSETTE_DIR = path.resolve(import.meta.dirname, '../cassettes');

export async function loadCassette(name: string): Promise<Cassette> {
  try {
    return cassetteSchema.parse(JSON.parse(await readFile(path.join(CASSETTE_DIR, `${name}.json`), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCassette(name);
    throw error;
  }
}

export async function saveCassette(cassette: Cassette): Promise<void> {
  await mkdir(CASSETTE_DIR, { recursive: true });
  const stamped = { ...cassette, recordedAt: new Date().toISOString() };
  await writeFile(path.join(CASSETTE_DIR, `${cassette.name}.json`), `${JSON.stringify(stamped, null, 2)}\n`);
}
