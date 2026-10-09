import type { Charter, Destination } from '../../core/charter/schema';
import { fileName, parentFolder } from '../../core/model/paths';
import type { AddedFolder, WizardChanges } from './wizard-state';

/**
 * One line of the Adjust step's folder tree: a folder of the charter, a folder being added, or a
 * folder that only groups others (a Johnny.Decimal area), each followed by the folders inside it.
 */
export type AdjustNode =
  | { kind: 'group'; folder: string; children: AdjustNode[] }
  | { kind: 'destination'; destination: Destination; children: AdjustNode[] }
  | { kind: 'added'; added: AddedFolder; children: AdjustNode[] };

/** A folder path as typed, without surrounding spaces or slashes. */
export const cleanPath = (path: string): string => path.trim().replace(/^\/+|\/+$/g, '');

/**
 * The Adjust step's folders as a tree, so every subfolder shows right under the folder it was added
 * to. The charter's folders keep their order; new top-level folders come after them. A new folder
 * stays where it was added while its path is typed, so the row never jumps away from the cursor.
 */
export function adjustTree(base: Charter, changes: WizardChanges): AdjustNode[] {
  const top: AdjustNode[] = [];
  /** Folder path (lower case) → the node whose children it holds; the first claim wins. */
  const holders = new Map<string, AdjustNode>();
  const claim = (path: string, node: AdjustNode) => {
    const key = cleanPath(path).toLowerCase();
    if (key !== '' && !holders.has(key)) holders.set(key, node);
  };
  const place = (node: AdjustNode, parent: string) => {
    const key = cleanPath(parent).toLowerCase();
    if (key === '') return void top.push(node);
    let holder = holders.get(key);
    if (!holder || holder === node) {
      // A parent that is no folder of the charter (a Johnny.Decimal area) shows as a group.
      holder = { kind: 'group', folder: cleanPath(parent), children: [] };
      holders.set(key, holder);
      top.push(holder);
    }
    holder.children.push(node);
  };

  for (const destination of base.destinations) {
    if (changes.removed.includes(destination.id)) continue;
    const node: AdjustNode = { kind: 'destination', destination, children: [] };
    place(node, destination.path !== undefined ? parentFolder(destination.path) : '');
    if (destination.path !== undefined) {
      claim(destination.path, node);
      claim(changes.paths[destination.id] ?? destination.path, node);
    }
  }
  for (const added of changes.added) {
    const node: AdjustNode = { kind: 'added', added, children: [] };
    place(node, added.group);
    claim(added.path, node);
  }
  return top;
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
