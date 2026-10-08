import type { Charter, Destination } from '../charter/schema';
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

/**
 * Below this confidence a placement by similar notes or the model goes to the fallback instead: in
 * practice, the model's two answers disagreed (calibrated to about 0.4) or it was unsure itself.
 */
export const FALLBACK_BELOW = 0.5;

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
 * With a fallback destination in the charter, those notes, and notes placed with little confidence, go
 * there instead (ADR 0010), so an accepted plan leaves no note behind.
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
  const fallback = charter.destinations.find((d) => d.fallback);
  let fallbacks = 0;

  for (const original of [...classification.placements.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const note = notes.get(original.path);
    if (!note) continue;
    const placement = fallback ? toFallback(original, fallback, charter) : original;
    if (placement !== original) fallbacks++;
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
  if (fallback && fallbacks > 0) {
    const where = fallback.path ?? fallback.category ?? fallback.id;
    warnings.push({
      code: 'fallback',
      message: `${plural(fallbacks, 'note')} fit no folder for sure, so ${fallbacks === 1 ? 'it goes' : 'they go'} to ${where}. Add folders for ${fallbacks === 1 ? 'it' : 'them'} in the charter, and organizing again moves ${fallbacks === 1 ? 'it' : 'them'} there.`,
      opIds: [],
    });
  }
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
 * The fallback placement for a note nothing places, or places with little confidence; the placement
 * itself otherwise. Filing a note there is the charter's own rule, so it is certain; the reason keeps
 * the best guess, for moving the note by hand.
 */
function toFallback(placement: Placement, fallback: Destination, charter: Charter): Placement {
  const unsure = placement.destination !== null && (placement.source === 'knn' || placement.source === 'llm') && placement.confidence < FALLBACK_BELOW;
  if (placement.destination !== null && !unsure) return placement;
  const guess = unsure ? charter.destinations.find((d) => d.id === placement.destination) : undefined;
  const rationale = guess ? `No folder fits for sure (best guess: ${guess.path ?? guess.category ?? guess.id}, ${Math.round(placement.confidence * 100)} %).` : 'No folder fits for sure.';
  return { ...placement, destination: fallback.id, subfolder: null, source: 'rule', confidence: 1, rationale };
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
