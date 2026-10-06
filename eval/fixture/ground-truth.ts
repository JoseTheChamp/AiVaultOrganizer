import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod';
import { presetCharter } from '../../src/core/charter/presets';
import type { MethodId } from '../../src/core/model/methods';
import { NodeFsVault } from '../adapters/node-vault';

/**
 * Ground truth for an eval fixture (PLAN §8.1): for every note, what it is about and where each
 * organization method would put it, plus which links belong in the vault. Lives next to the notes
 * as `.ground-truth.json`; the dot keeps it out of the vault as Obsidian and the plugin see it.
 */

/** Methods the fixtures are labelled for, by their short key in the ground truth. */
export const FIXTURE_METHODS = { para: 'para', ace: 'ace', jd: 'johnny-decimal', flat: 'flat-categories', topics: 'topics' } as const satisfies Record<string, MethodId>;
export type FixtureMethod = keyof typeof FIXTURE_METHODS;
export const FIXTURE_METHOD_KEYS = Object.keys(FIXTURE_METHODS) as FixtureMethod[];

/** Destination id for daily notes (a system folder in every preset). */
export const DAILY = 'daily';
/** Destination id for notes that stay in the vault root (properties mode: Flat + categories). */
export const ROOT = 'root';

export const NOTE_KINDS = ['hub', 'note', 'meeting', 'daily', 'source', 'clipping', 'person'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

const destinationSchema = z.object({
  /** A destination id of the method's preset charter, or `daily` / `root`. */
  id: z.string().min(1),
  /** Subfolder for item and topic layouts (the project, area or topic name). */
  subfolder: z.string().min(1).optional(),
});
export type FixtureDestination = z.infer<typeof destinationSchema>;

const noteTruthSchema = z.object({
  persona: z.string(),
  /** The project, area or topic the note belongs to (`daily` for daily notes). */
  entity: z.string(),
  kind: z.enum(NOTE_KINDS),
  /** Subject label used for clustering metrics. */
  topic: z.string(),
  destinations: z.object({
    para: destinationSchema,
    ace: destinationSchema,
    jd: destinationSchema,
    flat: destinationSchema,
    topics: destinationSchema,
  }),
  isStub: z.boolean(),
  /** Path of the note this one paraphrases. */
  duplicateOf: z.string().optional(),
});
export type NoteTruth = z.infer<typeof noteTruthSchema>;

const pairSchema = z.tuple([z.string(), z.string()]);

export const groundTruthSchema = z.object({
  version: z.literal(1),
  fixture: z.string(),
  language: z.enum(['en', 'cs']),
  seed: z.number().int(),
  notes: z.record(z.string(), noteTruthSchema),
  /** Links present in the fixture, as written by its author (unordered pairs of note paths). */
  trueLinks: z.array(pairSchema),
  /** Links the messify step removed; link suggestions should find them again. */
  heldOutLinks: z.array(pairSchema),
});
export type GroundTruth = z.infer<typeof groundTruthSchema>;

export const GROUND_TRUTH_FILE = '.ground-truth.json';

/** Consistency problems between a ground truth and the notes of its fixture; empty when valid. */
export function validateGroundTruth(truth: GroundTruth, notePaths: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const path of notePaths) if (!truth.notes[path]) problems.push(`${path}: note has no ground truth`);
  const valid = new Map(
    FIXTURE_METHOD_KEYS.map((method) => {
      const charter = presetCharter(FIXTURE_METHODS[method], truth.language);
      return [method, new Set([...charter.destinations.map((d) => d.id), DAILY, ROOT])];
    }),
  );
  for (const [path, note] of Object.entries(truth.notes)) {
    if (!notePaths.has(path)) problems.push(`${path}: ground truth for a missing note`);
    for (const method of FIXTURE_METHOD_KEYS) {
      const id = note.destinations[method].id;
      if (!valid.get(method)?.has(id)) problems.push(`${path}: unknown ${method} destination "${id}"`);
    }
    if (note.duplicateOf !== undefined && !notePaths.has(note.duplicateOf)) problems.push(`${path}: duplicate of missing note ${note.duplicateOf}`);
  }
  for (const [name, pairs] of [['trueLinks', truth.trueLinks], ['heldOutLinks', truth.heldOutLinks]] as const) {
    for (const [a, b] of pairs) if (!notePaths.has(a) || !notePaths.has(b)) problems.push(`${name}: pair with a missing note (${a}, ${b})`);
  }
  return problems;
}

/** An unordered pair as one string key, for set lookups. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export interface LoadedFixture {
  name: string;
  root: string;
  vault: NodeFsVault;
  truth: GroundTruth;
}

/** Loads a fixture folder and checks its ground truth against the notes on disk. */
export async function loadFixture(root: string): Promise<LoadedFixture> {
  const truth = groundTruthSchema.parse(JSON.parse(await readFile(path.join(root, GROUND_TRUTH_FILE), 'utf8')));
  const vault = new NodeFsVault(root);
  const snapshot = await vault.snapshot();
  const problems = validateGroundTruth(truth, new Set(snapshot.notes.map((note) => note.path)));
  if (problems.length > 0) throw new Error(`Fixture ${root} is inconsistent:\n${problems.slice(0, 20).join('\n')}`);
  return { name: truth.fixture, root, vault, truth };
}

export async function writeGroundTruth(root: string, truth: GroundTruth): Promise<void> {
  await writeFile(path.join(root, GROUND_TRUTH_FILE), `${JSON.stringify(truth, null, 2)}\n`);
}
