import type { Charter } from '../../core/charter/schema';
import { RuleEngine } from '../../core/drift/rules';
import type { VaultSnapshot } from '../../core/model/note';
import { isInFolder } from '../../core/model/paths';

/** One folder of a charter as it would look in this vault. */
export interface TreeNode {
  name: string;
  /** What belongs here; empty for folders that only group others. */
  description: string;
  /** Notes that would be here by the charter's rules alone (already here, or moved by a rule). */
  notes: number;
  /** Existing subfolders (projects, topics), the first few. */
  subfolders: string[];
  moreSubfolders: number;
  kind: 'destination' | 'group' | 'inbox' | 'daily' | 'root';
  children: TreeNode[];
}

export interface CharterFit {
  tree: TreeNode[];
  /** Notes the rules place. */
  placed: number;
  /** Notes no rule places: for similar notes, the language model, or you. */
  open: number;
  /** Notes the charter governs (ignored notes and templates left out). */
  total: number;
}

const SHOWN_SUBFOLDERS = 4;

/**
 * A charter's folders as a tree fitted to the vault, each with the notes its rules would put there.
 * Rules only, so it is instant and needs no model; what they leave open is counted separately.
 */
export function charterFit(charter: Charter, snapshot: VaultSnapshot, charterPath: string | null): CharterFit {
  const engine = new RuleEngine(charter, charterPath);
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  let total = 0;
  let open = 0;
  for (const note of snapshot.notes) {
    const placement = engine.evaluate(note);
    if (placement.status === 'ignored' || placement.status === 'charter') continue;
    if (placement.status === 'system' && placement.role === 'templates') continue;
    total++;
    switch (placement.status) {
      case 'system':
        bump('daily');
        break;
      case 'ruled':
        bump(`d:${placement.destination.id}`);
        break;
      case 'placed':
        bump(placement.destination ? `d:${placement.destination.id}` : 'root');
        break;
      case 'inbox':
        bump('inbox');
        open++;
        break;
      case 'unplaced':
        open++;
        break;
    }
  }

  const tree: TreeNode[] = [];
  const insert = (path: string, leaf: Omit<TreeNode, 'name' | 'children'>) => {
    const segments = path.split('/');
    let level = tree;
    segments.forEach((segment, index) => {
      let node = level.find((candidate) => candidate.name === segment);
      if (!node) {
        node = { name: segment, description: '', notes: 0, subfolders: [], moreSubfolders: 0, kind: 'group', children: [] };
        level.push(node);
      }
      if (index === segments.length - 1) Object.assign(node, leaf);
      level = node.children;
    });
  };
  const subfolders = (path: string) =>
    snapshot.folders
      .filter((folder) => isInFolder(folder, path) && folder !== path && !folder.slice(path.length + 1).includes('/'))
      .map((folder) => folder.slice(path.length + 1))
      .sort();

  if (charter.inbox) insert(charter.inbox, { description: 'New notes wait here to be filed.', notes: counts.get('inbox') ?? 0, subfolders: [], moreSubfolders: 0, kind: 'inbox' });
  if (charter.mode === 'properties') {
    tree.push({ name: 'Vault root', description: 'Your own notes; their categories say what they are.', notes: counts.get('root') ?? 0, subfolders: [], moreSubfolders: 0, kind: 'root', children: [] });
  }
  for (const destination of charter.destinations) {
    const notes = counts.get(`d:${destination.id}`) ?? 0;
    if (!destination.path) {
      tree.push({ name: destination.category ?? destination.id, description: destination.description, notes, subfolders: [], moreSubfolders: 0, kind: 'destination', children: [] });
      continue;
    }
    const existing = destination.layout === 'flat' ? [] : subfolders(destination.path);
    insert(destination.path, { description: destination.description, notes, subfolders: existing.slice(0, SHOWN_SUBFOLDERS), moreSubfolders: Math.max(0, existing.length - SHOWN_SUBFOLDERS), kind: 'destination' });
  }
  if (charter.system.daily) insert(charter.system.daily.path, { description: 'Daily notes.', notes: counts.get('daily') ?? 0, subfolders: [], moreSubfolders: 0, kind: 'daily' });

  // A folder that only groups others (an ACE "Atlas", a Johnny.Decimal area) counts what they hold.
  const holds = (node: TreeNode): number => {
    const inside = node.children.reduce((sum, child) => sum + holds(child), 0);
    if (node.kind === 'group') node.notes = inside;
    return node.kind === 'group' ? inside : node.notes + inside;
  };
  tree.forEach(holds);
  return { tree, placed: total - open, open, total };
}
