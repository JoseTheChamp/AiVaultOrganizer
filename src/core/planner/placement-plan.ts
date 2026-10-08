import type { Charter } from '../charter/schema';
import type { NoteRecord, VaultSnapshot } from '../model/note';
import { createOperation, type Operation, type OperationIntent } from '../model/operation';
import { fileName, isInFolder, joinPath, parentFolder } from '../model/paths';
import type { PlanWarning } from '../model/plan';
import { plural } from '../model/text';
import { type Classification, DAILY, type Placement, ROOT } from './classify';

type SetPropertyValue = Extract<OperationIntent, { kind: 'setProperty' }>['value'];

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
 * says (with the folders it needs), a `categories` update for destinations that a category link
 * defines (properties and hybrid mode), and an `ambiguous` flag for every note no stage could place.
 * A note placed in an item or topic destination without a known subfolder stays wherever it already
 * is inside that destination. A move onto an existing file is flagged instead of renamed.
 */
export function placementOperations(classification: Classification, snapshot: VaultSnapshot, charter: Charter): { operations: Operation[]; warnings: PlanWarning[] } {
  const notes = new Map(snapshot.notes.map((note) => [note.path, note]));
  const existing = new Set(snapshot.folders.map((folder) => folder.toLowerCase()));
  const taken = new Set([...snapshot.notes.map((n) => n.path), ...snapshot.otherFiles.map((f) => f.path)].map((p) => p.toLowerCase()));
  const folders = new Set<string>();
  const moves: Operation[] = [];
  const categories: Operation[] = [];
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
    let move: Operation | null = null;
    if (target !== null && !inPlace(note, placement, target, charter)) {
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
      // The target only: applying creates its parents, and a parent that is no destination itself
      // (a Johnny.Decimal area) would fail validation as a change of its own.
      if (target && !existing.has(target.toLowerCase())) folders.add(target);
      move = createOperation({ kind: 'move', from: note.path, to }, { ...meta, rationale: `${placement.rationale} → "${target || 'vault root'}"` });
      moves.push(move);
    }
    const category = categoryOperation(note, placement, charter, move, meta);
    if (category) categories.push(category);
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
  return { operations: [...created, ...moves, ...categories, ...flags], warnings };
}

/**
 * A destination defined by a category link holds a note when the note's `categories` property
 * lists that link (Flat + categories, hybrid charters). The update follows the note's move, if any.
 */
function categoryOperation(note: NoteRecord, placement: Placement, charter: Charter, move: Operation | null, meta: Pick<Operation, 'source' | 'confidence' | 'precondition'>): Operation | null {
  const category = charter.destinations.find((d) => d.id === placement.destination)?.category;
  if (!category) return null;
  const current = note.frontmatter.categories;
  // Existing values are kept exactly as they are (frontmatter is YAML, so they are JSON values).
  const list = (Array.isArray(current) ? [...(current as unknown[])] : current === undefined || current === null ? [] : [current]) as SetPropertyValue[];
  if (list.some((value) => typeof value === 'string' && value.toLowerCase() === category.toLowerCase())) return null;
  return createOperation(
    { kind: 'setProperty', path: move?.kind === 'move' ? move.to : note.path, key: 'categories', value: [...list, category] },
    { ...meta, rationale: `${placement.rationale} Adds ${category} to its categories.`, ...(move ? { dependsOn: [move.id] } : {}) },
  );
}

function inPlace(note: NoteRecord, placement: Placement, target: string, charter: Charter): boolean {
  if (parentFolder(note.path).toLowerCase() === target.toLowerCase()) return true;
  const destination = charter.destinations.find((d) => d.id === placement.destination);
  // Without a known subfolder, any folder inside an item or topic destination is fine.
  return Boolean(destination?.path && destination.layout !== 'flat' && !placement.subfolder && isInFolder(note.path, destination.path));
}
