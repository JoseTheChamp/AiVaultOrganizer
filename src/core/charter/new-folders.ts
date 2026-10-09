import { matchesAnyGlob } from '../model/glob';
import type { VaultSnapshot } from '../model/note';
import { parentFolder } from '../model/paths';
import type { Charter } from './schema';

/**
 * Folders the user made inside the charter's structure that the charter does not know yet: a new
 * category in a Johnny.Decimal area ("10-19 Life admin/15 Travel"), or a folder inside a flat
 * destination. Notes are only filed into the charter's folders, so until such a folder joins the
 * charter, organizing would leave it empty, or move out what the user put in it.
 *
 * Not listed: top-level folders (a new one cannot be told from a leftover of the old structure),
 * subfolders of item and topic destinations (a new project in PARA's Projects is used as it is),
 * system folders and ignored ones.
 */
export function newFolders(snapshot: VaultSnapshot, charter: Charter): string[] {
  const lower = (path: string) => path.toLowerCase();
  const destinations = charter.destinations.filter((d) => d.path !== undefined);
  const known = [...destinations.map((d) => d.path as string), charter.inbox, charter.system.daily?.path, charter.system.attachments, charter.system.templates]
    .filter((path): path is string => Boolean(path))
    .map(lower);
  const isKnown = (folder: string) => known.some((path) => path === folder || path.startsWith(`${folder}/`));
  const groups = (folder: string) => destinations.some((d) => lower(d.path as string).startsWith(`${folder}/`));
  const flat = (folder: string) => destinations.some((d) => d.layout === 'flat' && lower(d.path as string) === folder);

  return snapshot.folders.filter((folder) => {
    const key = lower(folder);
    const parent = lower(parentFolder(folder));
    if (parent === '' || isKnown(key) || matchesAnyGlob(`${folder}/x`, charter.ignore)) return false;
    return (groups(parent) && !known.includes(parent)) || flat(parent);
  });
}
