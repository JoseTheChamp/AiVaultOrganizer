import type { Charter, Destination } from '../../core/charter/schema';
import { fileName, parentFolder } from '../../core/model/paths';
import type { AddedFolder, WizardChanges } from './wizard-state';

/** One block of the Adjust step: a parent folder with the folders kept or added in it. */
export interface AdjustGroup {
  /** The parent folder; '' for the top level. */
  folder: string;
  destinations: Destination[];
  added: AddedFolder[];
}

/**
 * The Adjust step's rows grouped by parent folder, so a Johnny.Decimal area or an ACE "Atlas" shows
 * its folders together, with a place to add one more. The top level comes first, then the parents by
 * name, which keeps numbered areas in order.
 */
export function adjustGroups(base: Charter, changes: WizardChanges): AdjustGroup[] {
  const groups = new Map<string, AdjustGroup>();
  const group = (folder: string) => {
    let found = groups.get(folder);
    if (!found) groups.set(folder, (found = { folder, destinations: [], added: [] }));
    return found;
  };
  for (const destination of base.destinations) {
    if (changes.removed.includes(destination.id)) continue;
    group(destination.path !== undefined ? parentFolder(destination.path) : '').destinations.push(destination);
  }
  for (const folder of changes.added) group(folder.group).added.push(folder);
  return [...groups.values()].sort((a, b) => (a.folder === '' ? -1 : b.folder === '' ? 1 : a.folder.localeCompare(b.folder, undefined, { numeric: true })));
}

const JD_AREA = /^(\d{2})-(\d{2}) /;
const JD_NUMBER = /^(\d{2}) /;

/**
 * How the path of a new folder inside `parent` starts: in a Johnny.Decimal area its first free category
 * number ("10-19 Life admin/14 "), skipping numbers the inbox or daily notes use; elsewhere the parent
 * ("2 Areas/"). The top level starts empty.
 */
export function subfolderStart(base: Charter, changes: WizardChanges, parent: string): string {
  if (parent === '') return '';
  const area = base.jd && parentFolder(parent) === '' ? JD_AREA.exec(parent) : null;
  if (!area) return `${parent}/`;
  const [low, high] = [Number(area[1]), Number(area[2])];
  const paths = [
    ...base.destinations.filter((d) => !changes.removed.includes(d.id)).map((d) => changes.paths[d.id] ?? d.path ?? ''),
    ...changes.added.map((folder) => folder.path),
    base.inbox ?? '',
    base.system.daily?.path ?? '',
  ];
  const used = new Set(paths.filter((path) => parentFolder(path) === parent).map((path) => Number(JD_NUMBER.exec(fileName(path))?.[1] ?? -1)));
  // Category x0 of an area is kept for managing the area itself, as Johnny.Decimal suggests; 00 is the index.
  for (let id = low === 0 ? 0 : low + 1; id <= high; id++) if (!used.has(id)) return `${parent}/${String(id).padStart(2, '0')} `;
  return `${parent}/`;
}
