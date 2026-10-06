import type { Charter } from '../charter/schema';
import type { NoteRecord, VaultSnapshot } from '../model/note';
import { createOperation, type Operation } from '../model/operation';
import { ancestorFolders, fileName, isInFolder, joinPath, parentFolder } from '../model/paths';
import type { PlanWarning } from '../model/plan';
import { plural } from '../model/text';
import { type Classification, DAILY, type Placement, ROOT } from './classify';

/** Characters that cannot appear in a folder name on some systems, or that Obsidian links reserve. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

/** A subfolder name safe to create: no separators or reserved characters, trimmed, not empty. */
export function safeFolderName(name: string): string {
  return name.replace(UNSAFE, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, 80);
}

/** Folder a placement puts its note in, or null when the destination prescribes none. */
export function targetFolder(placement: Placement, charter: Charter): string | null {
  if (placement.destination === DAILY) return charter.system.daily?.path ?? null;
  if (placement.destination === ROOT) return '';
  const destination = charter.destinations.find((d) => d.id === placement.destination);
  if (!destination?.path) return null;
  const subfolder = placement.subfolder ? safeFolderName(placement.subfolder) : '';
  return destination.layout !== 'flat' && subfolder ? joinPath(destination.path, subfolder) : destination.path;
}

/**
 * Turns placements into plan operations: a move for every note that is not where its placement
 * says (with the folders it needs), and an `ambiguous` flag for every note no stage could place.
 * A note placed in an item or topic destination without a known subfolder stays wherever it already
 * is inside that destination. A move onto an existing file is flagged instead of renamed.
 */
export function placementOperations(classification: Classification, snapshot: VaultSnapshot, charter: Charter): { operations: Operation[]; warnings: PlanWarning[] } {
  const notes = new Map(snapshot.notes.map((note) => [note.path, note]));
  const existing = new Set(snapshot.folders.map((folder) => folder.toLowerCase()));
  const taken = new Set([...snapshot.notes.map((n) => n.path), ...snapshot.otherFiles.map((f) => f.path)].map((p) => p.toLowerCase()));
  const folders = new Set<string>();
  const moves: Operation[] = [];
  const flags: Operation[] = [];

  for (const placement of [...classification.placements.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const note = notes.get(placement.path);
    if (!note) continue;
    const meta = {
      source: placement.source ?? 'knn',
      confidence: placement.confidence,
      precondition: { path: note.path, contentHash: note.contentHash },
    };
    if (placement.destination === null) {
      flags.push(createOperation({ kind: 'flag', path: note.path, issue: 'ambiguous' }, { ...meta, confidence: 0, rationale: placement.rationale }));
      continue;
    }
    const target = targetFolder(placement, charter);
    if (target === null || inPlace(note, placement, target, charter)) continue;
    const to = joinPath(target, fileName(note.path));
    if (taken.has(to.toLowerCase())) {
      flags.push(
        createOperation(
          { kind: 'flag', path: note.path, issue: 'duplicate', related: [to] },
          { ...meta, rationale: `${placement.rationale} A note named "${fileName(to)}" already exists in "${target || 'the vault root'}".` },
        ),
      );
      continue;
    }
    taken.delete(note.path.toLowerCase());
    taken.add(to.toLowerCase());
    for (const folder of [...ancestorFolders(joinPath(target, 'x')), ...(target ? [target] : [])]) {
      if (!existing.has(folder.toLowerCase())) folders.add(folder);
    }
    moves.push(createOperation({ kind: 'move', from: note.path, to }, { ...meta, rationale: `${placement.rationale} → "${target || 'vault root'}"` }));
  }

  const created = [...folders].sort().map((path) => createOperation({ kind: 'createFolder', path }, { source: 'rule', confidence: 1, rationale: 'Needed by the moves in this plan.' }));
  const warnings: PlanWarning[] = [];
  if (flags.some((op) => op.kind === 'flag' && op.issue === 'ambiguous')) {
    const ambiguous = flags.filter((op) => op.kind === 'flag' && op.issue === 'ambiguous');
    warnings.push({
      code: 'ambiguous',
      message: `${plural(ambiguous.length, 'note')} could not be placed with confidence. Review ${ambiguous.length === 1 ? 'it' : 'them'} yourself, or add rules or examples to the charter.`,
      opIds: ambiguous.map((op) => op.id),
    });
  }
  return { operations: [...created, ...moves, ...flags], warnings };
}

function inPlace(note: NoteRecord, placement: Placement, target: string, charter: Charter): boolean {
  if (parentFolder(note.path).toLowerCase() === target.toLowerCase()) return true;
  const destination = charter.destinations.find((d) => d.id === placement.destination);
  // Without a known subfolder, any folder inside an item or topic destination is fine.
  return Boolean(destination?.path && destination.layout !== 'flat' && !placement.subfolder && isInFolder(note.path, destination.path));
}
