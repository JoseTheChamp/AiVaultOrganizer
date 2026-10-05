import { describeRule } from '../charter/prose';
import type { Charter, Destination, Rule } from '../charter/schema';
import { normalizeTag } from '../markdown/parse-note';
import { matchesAnyGlob, matchesGlob } from '../model/glob';
import type { NoteRecord } from '../model/note';
import { fileName, isInFolder, joinPath } from '../model/paths';

/** Where a note should be according to the charter, and whether it is there. */
export interface Expectation {
  /** Folder the note should be in, or null when the destination does not prescribe a folder. */
  folder: string | null;
  /** Full path the note should have, when it is not in place. */
  path: string | null;
  /** Category link the note's `categories` property should contain (properties mode). */
  category: string | null;
  inPlace: boolean;
}

export type Placement =
  | { status: 'ignored' }
  | { status: 'charter' }
  | { status: 'system'; role: 'daily' | 'templates'; rule: string; expectation: Expectation }
  | { status: 'ruled'; destination: Destination; rule: string; expectation: Expectation }
  | { status: 'placed'; destination: Destination | null }
  | { status: 'inbox' }
  | { status: 'unplaced' };

/**
 * Deterministic placement (the first, free stage of the cascade, §7.6). Order: ignore globs, the
 * charter note, system folders (daily notes, templates), destination rules (highest priority wins,
 * then charter order), and finally where the note already is.
 */
export class RuleEngine {
  private readonly dailyPattern: RegExp | null;
  private readonly foldered: Destination[];

  constructor(
    readonly charter: Charter,
    private readonly charterPath: string | null = null,
  ) {
    const daily = charter.system.daily;
    this.dailyPattern = daily ? dateFormatRegExp(daily.filename) : null;
    // Deepest folder first, so nested destinations (Atlas/Maps inside Atlas) win.
    this.foldered = charter.destinations
      .filter((d): d is Destination & { path: string } => d.path !== undefined)
      .sort((a, b) => b.path.length - a.path.length);
  }

  evaluate(note: NoteRecord): Placement {
    const { charter } = this;
    if (matchesAnyGlob(note.path, charter.ignore)) return { status: 'ignored' };
    if (note.path === this.charterPath || note.frontmatter.charter === true) return { status: 'charter' };

    if (charter.system.templates && isInFolder(note.path, charter.system.templates)) {
      return { status: 'system', role: 'templates', rule: 'template', expectation: { folder: charter.system.templates, path: null, category: null, inPlace: true } };
    }
    const daily = charter.system.daily;
    if (daily && this.dailyPattern?.test(note.basename)) {
      const inPlace = isInFolder(note.path, daily.path);
      return {
        status: 'system',
        role: 'daily',
        rule: `name matches ${daily.filename}`,
        expectation: { folder: daily.path, path: inPlace ? null : joinPath(daily.path, fileName(note.path)), category: null, inPlace },
      };
    }

    let best: { destination: Destination; rule: Rule } | null = null;
    for (const destination of charter.destinations) {
      const rule = destination.match.find((candidate) => matchesRule(note, candidate));
      if (rule && (best === null || destination.priority > best.destination.priority)) best = { destination, rule };
    }
    if (best) {
      return { status: 'ruled', destination: best.destination, rule: describeRule(best.rule).replaceAll('`', ''), expectation: this.expect(note, best.destination) };
    }

    const container = this.destinationOf(note.path);
    if (container) return { status: 'placed', destination: container };
    if (charter.inbox && isInFolder(note.path, charter.inbox)) return { status: 'inbox' };
    if (charter.mode === 'properties' && note.folder === '') return { status: 'placed', destination: null };
    return { status: 'unplaced' };
  }

  /** The destination whose folder contains `path` (deepest wins). */
  destinationOf(path: string): Destination | null {
    return this.foldered.find((destination) => destination.path !== undefined && isInFolder(path, destination.path)) ?? null;
  }

  /** Where a note matched to `destination` belongs, honoring the destination's layout. */
  expect(note: NoteRecord, destination: Destination): Expectation {
    const category = this.charter.mode !== 'folders' && destination.category ? destination.category : null;
    const hasCategory = category === null || listValues(note.frontmatter.categories).some((value) => sameValue(value, category));
    if (!destination.path) return { folder: null, path: null, category, inPlace: hasCategory };
    const inFolder = isInFolder(note.path, destination.path);
    const folder = destination.layout === 'subfolder-per-item' ? joinPath(destination.path, note.basename) : destination.path;
    return {
      folder: inFolder ? null : folder,
      path: inFolder ? null : joinPath(folder, fileName(note.path)),
      category,
      inPlace: inFolder && hasCategory,
    };
  }
}

export function matchesRule(note: NoteRecord, rule: Rule): boolean {
  if ('equals' in rule) {
    const expected = (Array.isArray(rule.equals) ? rule.equals : [rule.equals]).map(String);
    return listValues(propertyValue(note, rule.property)).some((value) => expected.some((e) => sameValue(value, e)));
  }
  if ('exists' in rule) {
    const present = listValues(propertyValue(note, rule.property)).some((value) => value.trim() !== '');
    return rule.exists ? present : !present;
  }
  if ('tag' in rule) {
    const wanted = normalizeTag(rule.tag).toLowerCase();
    return note.tags.some((tag) => {
      const lower = tag.toLowerCase();
      return lower === wanted || lower.startsWith(`${wanted}/`);
    });
  }
  if ('filename' in rule) return new RegExp(rule.filename).test(note.basename);
  return matchesGlob(note.path, rule.pathGlob);
}

/** Property lookup by exact key, falling back to a case-insensitive match (`Type` vs `type`). */
function propertyValue(note: NoteRecord, key: string): unknown {
  if (key in note.frontmatter) return note.frontmatter[key];
  const match = Object.keys(note.frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match === undefined ? undefined : note.frontmatter[match];
}

function listValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return values.filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean').map(String);
}

function sameValue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Converts a moment-style file name format (YYYY-MM-DD, YYYYMMDD, [W]ww) into an anchored regex. */
export function dateFormatRegExp(format: string): RegExp {
  let source = '';
  for (let i = 0; i < format.length; ) {
    const rest = format.slice(i);
    const literal = /^\[([^\]]*)\]/.exec(rest);
    if (literal) {
      source += escape(literal[1] ?? '');
      i += literal[0].length;
      continue;
    }
    const token = ['YYYY', 'YY', 'MMMM', 'MMM', 'MM', 'M', 'DD', 'D', 'ww', 'w', 'HH', 'mm', 'ss', 'dddd', 'ddd'].find((t) => rest.startsWith(t));
    if (token) {
      source += TOKEN_PATTERNS[token];
      i += token.length;
    } else {
      source += escape(format.charAt(i));
      i++;
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

const TOKEN_PATTERNS: Record<string, string> = {
  YYYY: '\\d{4}',
  YY: '\\d{2}',
  MMMM: '\\p{L}+',
  MMM: '\\p{L}+',
  MM: '\\d{2}',
  M: '\\d{1,2}',
  DD: '\\d{2}',
  D: '\\d{1,2}',
  ww: '\\d{2}',
  w: '\\d{1,2}',
  HH: '\\d{2}',
  mm: '\\d{2}',
  ss: '\\d{2}',
  dddd: '\\p{L}+',
  ddd: '\\p{L}+',
};

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
