import { normalizeVaultPath } from '../model/paths';
import { err, ok, type Result } from '../model/result';
import { type Charter, type CharterInput, charterSchema } from './schema';
import { formatCharterIssues } from './summary';

/** What the setup wizard lets a user change before the charter is written (PLAN §2.1 step 3). */
export interface CharterChanges {
  /** New folder per destination id (destinations without a folder ignore it). */
  paths?: Record<string, string>;
  /** Destinations left out of the charter. */
  removed?: readonly string[];
  /** Inbox folder; an empty string removes the inbox. */
  inbox?: string;
  tagStyle?: 'keep' | 'lowercase-kebab';
  relatedHeading?: string;
  /** Maps of content (category notes in properties mode). */
  mocs?: boolean;
  /** Globs the plugin never touches. */
  ignore?: readonly string[];
}

/**
 * Applies the wizard's changes to a charter and validates the result as the charter note would be
 * validated. Returns readable problems instead of a charter when the changes do not make one: no
 * destination left, two destinations in one folder, an invalid folder name.
 */
export function customizeCharter(base: Charter, changes: CharterChanges): Result<Charter, string[]> {
  const removed = new Set(changes.removed ?? []);
  const destinations = base.destinations
    .filter((destination) => !removed.has(destination.id))
    .map((destination) => {
      const path = changes.paths?.[destination.id];
      return destination.path !== undefined && path !== undefined ? { ...destination, path: cleanFolder(path) } : destination;
    });
  const input: CharterInput = {
    ...base,
    destinations,
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

  const problems: string[] = [];
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

/** Folder names as people type them: surrounding spaces and slashes removed. */
function cleanFolder(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : normalizeVaultPath(trimmed);
}
