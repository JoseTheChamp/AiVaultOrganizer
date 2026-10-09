import type { CharterChanges, NewFolder } from '../../core/charter/customize';
import type { Charter, Destination } from '../../core/charter/schema';
import { fileName, joinPath, parentFolder } from '../../core/model/paths';
import type { AddedFolder, WizardChanges } from './wizard-state';

/**
 * One row of the Adjust step's folder tree, followed by the folders inside it: a folder of the
 * charter, a folder being added, or a folder that only groups others (a Johnny.Decimal area). `key`
 * identifies the row for ordering ('d:<id>', 'a:<key>', 'g:<path>'); `path` is where it is now.
 */
export type AdjustNode = { key: string; path: string; children: AdjustNode[] } & (
  | { kind: 'group' }
  | { kind: 'destination'; destination: Destination }
  | { kind: 'added'; added: AddedFolder }
);

/** A folder path as typed, without surrounding spaces or slashes. */
export const cleanPath = (path: string): string => path.trim().replace(/^\/+|\/+$/g, '');

/** Where a charter folder is now, after renaming. */
export function destinationPath(destination: Destination, changes: WizardChanges): string {
  return changes.paths[destination.id] ?? destination.path ?? '';
}

/**
 * The path a parent reference stands for: '' (the top level), 'd:<id>' (a charter folder, as renamed),
 * 'a:<key>' (a new folder) or 'g:<path>' (a folder that only groups others).
 */
export function parentPath(ref: string, base: Charter, changes: WizardChanges, seen: ReadonlySet<number> = new Set()): string {
  if (ref.startsWith('d:')) {
    const destination = base.destinations.find((d) => d.id === ref.slice(2));
    return destination ? destinationPath(destination, changes) : '';
  }
  if (ref.startsWith('a:')) {
    const parent = changes.added.find((folder) => folder.key === Number(ref.slice(2)));
    return parent && !seen.has(parent.key) ? addedPath(parent, base, changes, new Set([...seen, parent.key])) : '';
  }
  return ref.startsWith('g:') ? ref.slice(2) : '';
}

/** Where a new folder will be: inside its parent as that parent is named now. Empty until it has a name. */
export function addedPath(folder: AddedFolder, base: Charter, changes: WizardChanges, seen: ReadonlySet<number> = new Set([folder.key])): string {
  const name = cleanPath(folder.name);
  return name === '' ? '' : joinPath(cleanPath(parentPath(folder.parent, base, changes, seen)), name);
}

/**
 * The Adjust step's folders as a tree: every folder under the folder it is in, a new folder under the
 * one it was added to, and siblings in the order the user dragged them into (otherwise the charter's,
 * with new folders last). Renaming a folder carries the new folders inside it along.
 */
export function adjustTree(base: Charter, changes: WizardChanges): AdjustNode[] {
  const top: AdjustNode[] = [];
  const byKey = new Map<string, AdjustNode>();
  const holderOfPath = new Map<string, AdjustNode>();
  const groupFor = (path: string): AdjustNode => {
    const key = `g:${path}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, kind: 'group', path, children: [] };
      byKey.set(key, group);
      top.push(group);
    }
    return group;
  };

  for (const destination of base.destinations) {
    if (changes.removed.includes(destination.id)) continue;
    const node: AdjustNode = { key: `d:${destination.id}`, kind: 'destination', destination, path: destinationPath(destination, changes), children: [] };
    byKey.set(node.key, node);
    // A charter folder sits where the charter put it, under another of its folders or a group.
    const parent = destination.path !== undefined ? parentFolder(destination.path) : '';
    const holder = parent === '' ? null : (holderOfPath.get(parent.toLowerCase()) ?? groupFor(parent));
    (holder ? holder.children : top).push(node);
    if (destination.path !== undefined) holderOfPath.set(destination.path.toLowerCase(), node);
  }
  for (const added of changes.added) {
    const node: AdjustNode = { key: `a:${added.key}`, kind: 'added', added, path: addedPath(added, base, changes), children: [] };
    byKey.set(node.key, node);
    const holder = added.parent === '' ? null : (byKey.get(added.parent) ?? (added.parent.startsWith('g:') ? groupFor(added.parent.slice(2)) : null));
    (holder ? holder.children : top).push(node);
  }

  const rank = new Map(changes.order.map((key, index) => [key, index]));
  const sort = (nodes: AdjustNode[]): AdjustNode[] =>
    nodes
      .map((node, index) => ({ node, index }))
      .sort((a, b) => (rank.get(a.node.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.node.key) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
      .map(({ node }) => ({ ...node, children: sort(node.children) }));
  return sort(top);
}

/** Every row key, parents before their children: the order to keep after a move. */
export function flatten(nodes: readonly AdjustNode[]): string[] {
  return nodes.flatMap((node) => [node.key, ...flatten(node.children)]);
}

/** The siblings `key` is among, or null when it is not in the tree. */
export function siblingsOf(nodes: readonly AdjustNode[], key: string): readonly AdjustNode[] | null {
  if (nodes.some((node) => node.key === key)) return nodes;
  for (const node of nodes) {
    const found = siblingsOf(node.children, key);
    if (found) return found;
  }
  return null;
}

/**
 * The order after moving row `key` before or after its sibling `target`. Rows only move among their
 * siblings: putting a folder into another one would change where its notes go, which renaming does
 * explicitly. Returns null when `target` is no sibling.
 */
export function moveNode(nodes: readonly AdjustNode[], key: string, target: string, after: boolean): string[] | null {
  const siblings = siblingsOf(nodes, key);
  if (!siblings || key === target || !siblings.some((node) => node.key === target)) return null;
  const reorder = (list: readonly AdjustNode[]): AdjustNode[] => {
    if (list !== siblings) return list.map((node) => ({ ...node, children: reorder(node.children) }));
    const moving = list.find((node) => node.key === key) as AdjustNode;
    const rest = list.filter((node) => node.key !== key);
    const at = rest.findIndex((node) => node.key === target) + (after ? 1 : 0);
    return [...rest.slice(0, at), moving, ...rest.slice(at)];
  };
  return flatten(reorder(nodes));
}

/** The wizard's changes as the charter takes them: new folders with their full paths, in tree order. */
export function charterChanges(base: Charter, changes: WizardChanges): CharterChanges {
  const added: NewFolder[] = changes.added.map((folder) => ({ key: folder.key, path: addedPath(folder, base, changes), description: folder.description }));
  // A new folder still without a name is reported, not dropped.
  return { ...changes, added, order: flatten(adjustTree(base, changes)) };
}

const JD_AREA = /^(\d{2})-(\d{2}) /;
const JD_NUMBER = /^(\d{2}) /;

/**
 * How the name of a new folder inside `parent` starts: in a Johnny.Decimal area, its first free
 * category number ("14 "), skipping numbers the inbox or daily notes use; otherwise nothing.
 */
export function subfolderStart(base: Charter, changes: WizardChanges, parent: string): string {
  const area = base.jd && parent !== '' && parentFolder(parent) === '' ? JD_AREA.exec(parent) : null;
  if (!area) return '';
  const [low, high] = [Number(area[1]), Number(area[2])];
  const paths = [
    ...base.destinations.filter((d) => !changes.removed.includes(d.id)).map((d) => destinationPath(d, changes)),
    ...changes.added.map((folder) => addedPath(folder, base, changes)),
    base.inbox ?? '',
    base.system.daily?.path ?? '',
  ];
  const used = new Set(paths.filter((path) => parentFolder(path) === parent).map((path) => Number(JD_NUMBER.exec(fileName(path))?.[1] ?? -1)));
  // Category x0 of an area is kept for managing the area itself, as Johnny.Decimal suggests; 00 is the index.
  for (let id = low === 0 ? 0 : low + 1; id <= high; id++) if (!used.has(id)) return `${String(id).padStart(2, '0')} `;
  return '';
}
