import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MESSIFY, messify, type MessyFixture } from '../generator/messify';
import { generatePersonaVault } from '../generator/persona-vault';
import { csStudent } from '../generator/personas/cs-student';
import { enDeveloper } from '../generator/personas/en-developer';
import type { Persona } from '../generator/personas/types';
import { GROUND_TRUTH_FILE } from './ground-truth';

export interface FixtureSpec {
  persona: Persona;
  seed: number;
  scale: number;
  dailyNotes: number;
  /** Committed under fixtures/vaults (small, used in CI); others are generated on demand. */
  committed: boolean;
}

/** The eval fixtures (PLAN §8.1). Changing a spec changes the fixture: rebuild and re-baseline. */
export const FIXTURES: Record<string, FixtureSpec> = {
  'en-small': { persona: enDeveloper, seed: 101, scale: 1, dailyNotes: 8, committed: true },
  'cs-small': { persona: csStudent, seed: 202, scale: 1, dailyNotes: 8, committed: true },
  'en-medium': { persona: enDeveloper, seed: 303, scale: 8, dailyNotes: 8, committed: false },
};

export const FIXTURES_DIR = path.join('fixtures', 'vaults');

export function buildFixture(name: string): MessyFixture {
  const spec = FIXTURES[name];
  if (!spec) throw new Error(`Unknown fixture "${name}". Known: ${Object.keys(FIXTURES).join(', ')}`);
  const clean = generatePersonaVault(spec.persona, { seed: spec.seed, scale: spec.scale, dailyNotes: spec.dailyNotes });
  return messify(clean, { fixture: name, language: spec.persona.language }, { ...DEFAULT_MESSIFY, seed: spec.seed });
}

/** Writes a fixture folder: notes, a `.gitkeep` per empty folder, and the hidden ground truth. */
export async function writeFixture(root: string, fixture: MessyFixture): Promise<void> {
  for (const [file, content] of Object.entries(fixture.files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  for (const folder of fixture.emptyFolders) {
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, folder, '.gitkeep'), '');
  }
  await writeFile(path.join(root, GROUND_TRUTH_FILE), `${JSON.stringify(fixture.truth, null, 2)}\n`);
}
