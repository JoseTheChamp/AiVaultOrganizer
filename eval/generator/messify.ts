import { type GroundTruth, type NoteTruth, pairKey } from '../fixture/ground-truth';
import { type GeneratedNote, renderNote } from './persona-vault';
import { chance, mulberry32, pick, type Random, sample, shuffle } from './random';

export interface MessifyOptions {
  seed: number;
  /** Share of links removed and kept as held-out ground truth. */
  holdOut: number;
  /** Share of regular notes turned into stubs. */
  stubs: number;
  /** Share of regular notes that get a paraphrased duplicate. */
  duplicates: number;
  /** Empty folders added. */
  emptyFolders: number;
}

export const DEFAULT_MESSIFY: Omit<MessifyOptions, 'seed'> = { holdOut: 0.3, stubs: 0.05, duplicates: 0.05, emptyFolders: 3 };

export interface MessyFixture {
  /** Vault-relative path → Markdown. */
  files: Record<string, string>;
  /** Folders without notes (written with a hidden `.gitkeep`). */
  emptyFolders: string[];
  truth: GroundTruth;
}

const WORDS = {
  en: {
    inbox: 'Inbox',
    odd: ['Misc', 'Old notes', 'Work stuff', 'To sort'],
    empty: ['New folder', 'Archive old', 'Temp', 'Ideas 2025'],
    copy: ['(copy)', 'draft', 'v2'],
  },
  cs: {
    inbox: 'Doručené',
    odd: ['Různé', 'Staré poznámky', 'Škola', 'Roztřídit'],
    empty: ['Nová složka', 'Starý archiv', 'Dočasné', 'Nápady 2025'],
    copy: ['(kopie)', 'koncept', 'v2'],
  },
} as const;

interface Working extends GeneratedNote {
  folder: string;
}

/**
 * Turns a clean generated vault into a realistic messy one with ground truth (PLAN §8.1), in a
 * fixed, seeded order: stubs, paraphrased duplicates, held-out links, inconsistent properties and
 * tags, scattering into the root, an inbox and odd folders, and empty folders. Labels never change:
 * the ground truth says where each note belongs however messy its current place is.
 */
export function messify(clean: readonly GeneratedNote[], meta: { fixture: string; language: 'en' | 'cs' }, options: MessifyOptions): MessyFixture {
  const random = mulberry32(options.seed);
  const words = WORDS[meta.language];
  let notes: Working[] = clean.map((note) => ({ ...note, frontmatter: { ...note.frontmatter }, links: [...note.links], folder: parent(note.path), truth: { ...note.truth } }));

  makeStubs(random, notes, options.stubs);
  notes = [...notes, ...makeDuplicates(random, notes, options.duplicates, words.copy)];
  const heldOut = holdOutLinks(random, notes, options.holdOut);
  for (const note of notes) messProperties(random, note);
  scatter(random, notes, words);

  const pathOf = new Map(notes.map((note) => [note.title, `${note.folder ? `${note.folder}/` : ''}${note.title}.md`]));
  const files: Record<string, string> = {};
  const truthNotes: Record<string, NoteTruth> = {};
  const linked = new Map<string, [string, string]>();
  for (const note of notes) {
    const path = pathOf.get(note.title) as string;
    files[path] = renderNote(note.frontmatter, note.body);
    truthNotes[path] = note.truth;
    for (const target of note.links) {
      const targetPath = pathOf.get(target);
      if (targetPath && targetPath !== path) linked.set(pairKey(path, targetPath), ordered(path, targetPath));
    }
  }
  // Duplicates point at the original's final path.
  for (const note of notes) {
    if (note.truth.duplicateOf === undefined) continue;
    const path = pathOf.get(note.title) as string;
    const original = pathOf.get(note.truth.duplicateOf);
    truthNotes[path] = { ...note.truth, ...(original ? { duplicateOf: original } : {}) };
  }
  const held = new Map<string, [string, string]>();
  for (const [from, to] of heldOut) {
    const a = pathOf.get(from);
    const b = pathOf.get(to);
    // A pair still linked the other way round is not missing.
    if (a && b && a !== b && !linked.has(pairKey(a, b))) held.set(pairKey(a, b), ordered(a, b));
  }

  const used = new Set(Object.keys(files).flatMap((path) => ancestors(path)));
  const emptyFolders = sample(random, words.empty, options.emptyFolders).filter((folder) => !used.has(folder));
  return {
    files,
    emptyFolders,
    truth: {
      version: 1,
      fixture: meta.fixture,
      language: meta.language,
      seed: options.seed,
      notes: truthNotes,
      trueLinks: [...linked.values()].sort(comparePairs),
      heldOutLinks: [...held.values()].sort(comparePairs),
    },
  };
}

/** A few regular notes shrink to a title and half a sentence; their links go with them. */
function makeStubs(random: Random, notes: Working[], share: number): void {
  const regular = notes.filter((note) => note.truth.kind === 'note');
  for (const note of sample(random, regular, Math.round(regular.length * share))) {
    const firstWords = note.body.split(/\s+/).slice(0, 5).join(' ');
    note.body = `${firstWords}…`;
    note.links = [];
    note.frontmatter = {};
    note.truth = { ...note.truth, isStub: true };
  }
}

/** Paraphrased copies: same sentences reordered with one dropped, a variant title, no links. */
function makeDuplicates(random: Random, notes: Working[], share: number, suffixes: readonly string[]): Working[] {
  const regular = notes.filter((note) => note.truth.kind === 'note' && !note.truth.isStub);
  const taken = new Set(notes.map((note) => note.title.toLowerCase()));
  return sample(random, regular, Math.max(1, Math.round(regular.length * share))).map((original) => {
    const sentences = sentencesOf(original.body);
    const kept = shuffle(random, sentences).slice(0, Math.max(1, sentences.length - 1));
    let title = `${original.title} ${pick(random, suffixes)}`;
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${original.title} ${n}`;
    taken.add(title.toLowerCase());
    return {
      ...original,
      title,
      frontmatter: {},
      body: kept.join(' '),
      links: [],
      truth: { ...original.truth, duplicateOf: original.title },
    };
  });
}

/** Removes a share of links (the visible text stays) and returns them as [from, to] titles. */
function holdOutLinks(random: Random, notes: Working[], share: number): [string, string][] {
  const removed: [string, string][] = [];
  for (const note of notes) {
    note.links = note.links.filter((target) => {
      if (!chance(random, share)) return true;
      note.body = note.body.replace(`[[${target}]]`, target);
      removed.push([note.title, target]);
      return false;
    });
  }
  return removed;
}

/** Real vaults drift: properties get dropped or renamed, tag casing varies, tags move inline. */
function messProperties(random: Random, note: Working): void {
  const fm = note.frontmatter;
  if ('type' in fm) {
    if (chance(random, 0.35)) delete fm.type;
    else if (chance(random, 0.2)) renameKey(fm, 'type', pick(random, ['Type', 'kind']));
  }
  if ('status' in fm && chance(random, 0.25)) renameKey(fm, 'status', 'Status');
  if ('date' in fm && chance(random, 0.3)) renameKey(fm, 'date', 'created');
  const tags = fm.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const roll = random();
    if (roll < 0.3) {
      delete fm.tags;
      note.body = `${note.body}\n\n${tags.map((tag) => `#${String(tag)}`).join(' ')}`;
    } else if (roll < 0.51) {
      fm.tags = tags.map((tag) => capitalize(String(tag)));
    }
  }
}

/**
 * Most notes leave their clean place: the root, an inbox, odd folders, or a folder named after
 * their project at the top level. A few stay where they belong, like a half-migrated vault.
 */
function scatter(random: Random, notes: Working[], words: (typeof WORDS)[keyof typeof WORDS]): void {
  for (const note of notes) {
    const roll = random();
    if (note.truth.kind === 'daily') {
      if (roll < 0.5) note.folder = '';
      continue;
    }
    const entityFolder = note.folder.split('/').at(-1) ?? '';
    if (roll < 0.35) note.folder = '';
    else if (roll < 0.55) note.folder = words.inbox;
    else if (roll < 0.7) note.folder = pick(random, words.odd);
    else if (roll < 0.9) note.folder = entityFolder;
    // else: stays in its clean folder
  }
}

function sentencesOf(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#') && !line.includes('[['))
    .join(' ')
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => sentence.trim() !== '');
}

function renameKey(record: Record<string, unknown>, from: string, to: string): void {
  // Rebuild to keep the renamed key in place, as a user editing the property would.
  const entries = Object.entries(record).map(([key, value]) => [key === from ? to : key, value] as const);
  for (const key of Object.keys(record)) delete record[key];
  for (const [key, value] of entries) record[key] = value;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parent(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

function ordered(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function comparePairs(x: [string, string], y: [string, string]): number {
  return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0;
}
