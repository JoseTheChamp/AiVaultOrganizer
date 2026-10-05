import type { Charter } from '../charter/schema';
import { RuleEngine } from '../drift/rules';
import type { NoteRecord, VaultSnapshot } from '../model/note';
import { createOperation, type Operation } from '../model/operation';
import { fileName, parentFolder } from '../model/paths';
import { createPlan, type Plan, type PlanWarning } from '../model/plan';
import { plural } from '../model/text';

export interface RulePlanOptions {
  /** Path of the charter note, which the plan never moves. */
  charterPath: string | null;
  now: Date;
  /** Propose creating destination, inbox and daily folders that don't exist yet. */
  createMissingFolders?: boolean;
}

/** Folders a plan may create notes or folders in (validator `allowedRoots`). */
export function charterRoots(charter: Charter): string[] {
  const roots = charter.destinations.map((d) => d.path).filter((p): p is string => p !== undefined);
  if (charter.inbox) roots.push(charter.inbox);
  if (charter.system.daily) roots.push(charter.system.daily.path);
  // Properties-mode vaults keep notes (and generated category notes) in the root.
  if (charter.mode === 'properties') roots.push('');
  return roots;
}

/**
 * Plan of everything the charter's deterministic rules imply (no AI): moves of notes whose rules
 * point elsewhere, `categories` updates in properties mode, and missing destination folders. Every
 * operation carries a precondition on the note's content hash, so notes edited after planning are
 * skipped at apply time. Collisions are flagged for the user instead of resolved by renaming.
 */
export function buildRulePlan(snapshot: VaultSnapshot, charter: Charter, options: RulePlanOptions): Plan {
  const engine = new RuleEngine(charter, options.charterPath);
  const meta = (note: NoteRecord | null, rationale: string) => ({
    source: 'rule' as const,
    confidence: 1,
    status: 'pending' as const,
    rationale,
    precondition: note ? { path: note.path, contentHash: note.contentHash } : undefined,
  });

  const operations: Operation[] = [];
  const folders = new Set(snapshot.folders.map((f) => f.toLowerCase()));
  if (options.createMissingFolders) {
    for (const folder of charterRoots(charter)) {
      if (folder === '' || folders.has(folder.toLowerCase())) continue;
      operations.push(createOperation({ kind: 'createFolder', path: folder }, meta(null, 'The charter defines this folder.')));
      folders.add(folder.toLowerCase());
    }
  }

  const taken = new Set([...snapshot.notes.map((n) => n.path), ...snapshot.otherFiles.map((f) => f.path)].map((p) => p.toLowerCase()));
  let unplaced = 0;
  let inbox = 0;
  for (const note of snapshot.notes) {
    const placement = engine.evaluate(note);
    if (placement.status === 'unplaced') unplaced++;
    if (placement.status === 'inbox') inbox++;
    if (placement.status !== 'ruled' && placement.status !== 'system') continue;
    const { expectation } = placement;
    if (expectation.inPlace) continue;
    const why =
      placement.status === 'system'
        ? `Daily notes live in "${expectation.folder ?? ''}".`
        : `Rule "${placement.rule}" places it in ${placement.destination.id} ("${placement.destination.path ?? placement.destination.category ?? ''}").`;

    if (expectation.path) {
      if (taken.has(expectation.path.toLowerCase())) {
        operations.push(
          createOperation(
            { kind: 'flag', path: note.path, issue: 'duplicate', related: [expectation.path] },
            meta(note, `${why} A note named "${fileName(expectation.path)}" already exists in "${parentFolder(expectation.path)}".`),
          ),
        );
        continue;
      }
      taken.delete(note.path.toLowerCase());
      taken.add(expectation.path.toLowerCase());
      operations.push(createOperation({ kind: 'move', from: note.path, to: expectation.path }, meta(note, why)));
    }
    if (expectation.category) {
      const current = note.frontmatter.categories;
      const list: unknown[] = Array.isArray(current) ? [...(current as unknown[])] : current === undefined || current === null ? [] : [current];
      if (!list.some((value) => String(value).toLowerCase() === expectation.category?.toLowerCase())) {
        const path = expectation.path ?? note.path;
        operations.push(
          createOperation(
            { kind: 'setProperty', path, key: 'categories', value: [...list.map(String), expectation.category] },
            meta(expectation.path ? null : note, `${why} Adds ${expectation.category} to its categories.`),
          ),
        );
      }
    }
  }

  const warnings: PlanWarning[] = [];
  if (unplaced > 0) {
    warnings.push({
      code: 'unplaced',
      message: `${plural(unplaced, 'note')} ${unplaced === 1 ? 'is' : 'are'} outside every destination and no rule places them. Move them yourself, add rules, or let the classifier propose places once AI is set up.`,
      opIds: [],
    });
  }
  if (inbox > 0) {
    warnings.push({ code: 'inbox', message: `${plural(inbox, 'note')} in the inbox ${inbox === 1 ? 'waits' : 'wait'} to be filed.`, opIds: [] });
  }

  const stamp = options.now.toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return createPlan({ id: `rules-${stamp}`, createdAt: options.now.toISOString(), charterRevision: charter.revision, operations, warnings });
}
