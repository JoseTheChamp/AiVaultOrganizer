import { fileName, normalizeVaultPath } from '../model/paths';
import { err, ok, type Result } from '../model/result';
import { slug } from './infer';
import { type Charter, type CharterInput, charterSchema, type DestinationInput } from './schema';
import { formatCharterIssues } from './summary';

/** What the setup wizard lets a user change before the charter is written (PLAN §2.1 step 3). */
export interface CharterChanges {
  /** New folder per destination id (destinations without a folder ignore it). */
  paths?: Record<string, string>;
  /** Destinations left out of the charter. */
  removed?: readonly string[];
  /** Folders of the user's own, after the method's (ADR 0010). */
  added?: readonly NewFolder[];
  /** Inbox folder; an empty string removes the inbox. */
  inbox?: string;
  tagStyle?: 'keep' | 'lowercase-kebab';
  relatedHeading?: string;
  /** Maps of content (category notes in properties mode). */
  mocs?: boolean;
  /** Globs the plugin never touches. */
  ignore?: readonly string[];
}

/** A folder the user adds: where, and what goes in it (the classifier reads only this text). */
export interface NewFolder {
  path: string;
  description: string;
}

/** A Johnny.Decimal category folder: "30-39 Learning/33 Photography". */
const JD_CATEGORY_PATH = /^(\d{2})-(\d{2}) ([^/]+)\/(\d{2}) ([^/]+)$/;

/**
 * Applies the wizard's changes to a charter and validates the result as the charter note would be
 * validated. Returns readable problems instead of a charter when the changes do not make one: no
 * destination left, two destinations in one folder, an invalid folder name.
 */
export function customizeCharter(base: Charter, changes: CharterChanges): Result<Charter, string[]> {
  const removed = new Set(changes.removed ?? []);
  const problems: string[] = [];
  const destinations: DestinationInput[] = base.destinations
    .filter((destination) => !removed.has(destination.id))
    .map((destination) => {
      const path = changes.paths?.[destination.id];
      return destination.path !== undefined && path !== undefined ? { ...destination, path: cleanFolder(path) } : destination;
    });
  const ids = new Set(destinations.map((destination) => destination.id));
  for (const folder of changes.added ?? []) {
    const path = cleanFolder(folder.path);
    const description = folder.description.trim();
    if (path === '') {
      problems.push('A new folder needs a name.');
      continue;
    }
    if (description === '') problems.push(`Say what goes into "${path}": AI files notes by that description.`);
    const id = uniqueId(slug(fileName(path)), ids);
    ids.add(id);
    // In Johnny.Decimal, a note named with the category's ID (33.01) belongs there, as in the method's own folders.
    const category = base.jd ? JD_CATEGORY_PATH.exec(path)?.[4] : undefined;
    destinations.push({ id, path, description, ...(category ? { match: [{ filename: `^${category}\\.\\d{2}(?:\\s|$)` }] } : {}) });
  }
  const input: CharterInput = {
    ...base,
    destinations,
    ...(base.jd ? { jd: jdIndex(destinations, base.jd) } : {}),
    ignore: changes.ignore ? changes.ignore.map((glob) => glob.trim()).filter((glob) => glob !== '') : base.ignore,
    conventions: {
      ...base.conventions,
      ...(changes.tagStyle ? { tags: { ...(base.conventions.tags ?? { nested: true }), style: changes.tagStyle } } : {}),
      ...(changes.relatedHeading !== undefined ? { links: { ...base.conventions.links, relatedHeading: changes.relatedHeading.trim() } } : {}),
    },
  };
  if (changes.inbox !== undefined) {
    const inbox = cleanFolder(changes.inbox);
    if (inbox === '') delete input.inbox;
    else input.inbox = inbox;
  }
  if (changes.mocs !== undefined) input.mocs = { ...(base.mocs ?? { perDestination: true }), enabled: changes.mocs };

  if (destinations.length === 0) problems.push('Keep at least one destination.');
  const seen = new Map<string, string>();
  for (const destination of destinations) {
    if (!destination.path) continue;
    const key = destination.path.toLowerCase();
    const other = seen.get(key);
    if (other) problems.push(`"${destination.path}" is used by two destinations (${other} and ${destination.id}).`);
    seen.set(key, destination.id);
  }
  const parsed = charterSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [section, index, field] = issue.path;
      const destination = section === 'destinations' && typeof index === 'number' ? destinations[index] : undefined;
      // Name the folder people typed rather than a position in the YAML.
      if (destination && field === 'path') problems.push(`Folder "${destination.path ?? ''}" (${destination.id}): ${issue.message}.`);
      else if (section === 'inbox') problems.push(`Inbox folder "${input.inbox ?? ''}": ${issue.message}.`);
      else problems.push(...formatCharterIssues([{ path: issue.path.map(String).join('.'), message: issue.message }]));
    }
  }
  return problems.length > 0 || !parsed.success ? err([...new Set(problems)]) : ok(parsed.data);
}

/** `base`, or `base-2`, `base-3`… when taken. */
function uniqueId(base: string, taken: ReadonlySet<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The Johnny.Decimal index of the folders as they now are: renamed, left out or added categories
 * show up in it. Folders that do not follow the numbering keep the index as it was.
 */
function jdIndex(destinations: readonly DestinationInput[], previous: NonNullable<Charter['jd']>): NonNullable<Charter['jd']> {
  const areas: NonNullable<Charter['jd']>['areas'] = [];
  for (const destination of destinations) {
    const [, low, high, areaName, id, name] = JD_CATEGORY_PATH.exec(destination.path ?? '') ?? [];
    if (!low || !high || !areaName || !id || !name) continue;
    let area = areas.find((candidate) => candidate.id === `${low}-${high}`);
    if (!area) areas.push((area = { id: `${low}-${high}`, name: areaName, categories: [] }));
    if (!area.categories.some((category) => category.id === id)) area.categories.push({ id, name });
  }
  return areas.length > 0 ? { areas: areas.sort((a, b) => a.id.localeCompare(b.id)) } : previous;
}

/** Folder names as people type them: surrounding spaces and slashes removed. */
function cleanFolder(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : normalizeVaultPath(trimmed);
}
