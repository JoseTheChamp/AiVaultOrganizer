import { ApplyRunService } from '../../src/core/apply/run';
import { UndoService } from '../../src/core/apply/undo';
import { presetCharter } from '../../src/core/charter/presets';
import type { NoteRecord, VaultSnapshot } from '../../src/core/model/note';
import { createOperation, type Operation } from '../../src/core/model/operation';
import { ancestorFolders, parentFolder } from '../../src/core/model/paths';
import { createPlan } from '../../src/core/model/plan';
import { applyHarness } from '../../src/core/testing/apply-harness';
import { DAILY, type GroundTruth } from '../fixture/ground-truth';

export interface SafetyMetrics {
  /** Moves in the plan that files every note where PARA says it belongs. */
  operations: number;
  applied: number;
  failed: number;
  /** Links that no longer resolve after applying (must be 0). */
  brokenLinks: number;
  /** Whether undo restored every byte and folder (must be true). */
  undoExact: boolean;
}

/**
 * Safety (PLAN §8.2): files every note where PARA says it belongs through the real apply path,
 * counts links that stopped resolving, then undoes the run and checks the vault is byte-identical.
 */
export async function applyAndUndo(snapshot: VaultSnapshot, contents: ReadonlyMap<string, string>, truth: GroundTruth): Promise<SafetyMetrics> {
  const harness = applyHarness(Object.fromEntries(contents), snapshot.folders);
  const { vault, deps, storage, clock } = harness;
  const original = { contents: vault.contents(), folders: vault.folderPaths() };
  const before = await vault.graph();

  const para = presetCharter('para', truth.language);
  const folderOf = (note: NoteRecord): string | null => {
    const destination = truth.notes[note.path]?.destinations.para;
    if (!destination) return null;
    if (destination.id === DAILY) return para.system.daily?.path ?? null;
    const root = para.destinations.find((d) => d.id === destination.id)?.path;
    if (!root) return null;
    return destination.subfolder ? `${root}/${destination.subfolder}` : root;
  };
  const moves: Operation[] = [];
  const folders = new Set<string>();
  for (const note of snapshot.notes) {
    const folder = folderOf(note);
    if (folder === null || folder === parentFolder(note.path)) continue;
    for (const ancestor of [...ancestorFolders(folder), folder]) if (!snapshot.folders.includes(ancestor)) folders.add(ancestor);
    moves.push(createOperation({ kind: 'move', from: note.path, to: `${folder}/${note.path.split('/').at(-1) ?? ''}` }, { status: 'accepted', precondition: { path: note.path, contentHash: note.contentHash } }));
  }
  const operations = [...[...folders].sort().map((path) => createOperation({ kind: 'createFolder', path }, { status: 'accepted' })), ...moves];
  const plan = createPlan({ id: 'eval-safety', createdAt: new Date(clock.now()).toISOString(), operations });
  const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'eval' });
  const after = await vault.graph();
  const report = outcome.kind === 'ran' ? outcome.report : null;
  await new UndoService(deps).undoLast();
  const undoExact = JSON.stringify(vault.contents()) === JSON.stringify(original.contents) && JSON.stringify(vault.folderPaths()) === JSON.stringify(original.folders);
  return {
    operations: operations.length,
    applied: report?.applied ?? 0,
    failed: report?.failed ?? operations.length,
    brokenLinks: Math.max(0, after.unresolvedCount - before.unresolvedCount) + Math.max(0, before.edges.length - after.edges.length),
    undoExact,
  };
}
