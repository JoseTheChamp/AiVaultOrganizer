import { ApplyRunService } from '../../src/core/apply/run';
import { UndoService } from '../../src/core/apply/undo';
import { presetCharter } from '../../src/core/charter/presets';
import { RuleEngine } from '../../src/core/drift/rules';
import type { NoteRecord, VaultSnapshot } from '../../src/core/model/note';
import { createOperation, type Operation } from '../../src/core/model/operation';
import { ancestorFolders, parentFolder } from '../../src/core/model/paths';
import { createPlan } from '../../src/core/model/plan';
import { applyHarness } from '../../src/core/testing/apply-harness';
import { DAILY, FIXTURE_METHOD_KEYS, FIXTURE_METHODS, type FixtureMethod, type GroundTruth } from '../fixture/ground-truth';
import { type ClassificationMetrics, classificationMetrics, type Prediction } from '../metrics/classification';

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

/** Tier 0 classification: what the preset charters' rules alone decide; everything else abstains. */
export function classifyByRules(snapshot: VaultSnapshot, truth: GroundTruth): Record<FixtureMethod, ClassificationMetrics> {
  const result = {} as Record<FixtureMethod, ClassificationMetrics>;
  for (const method of FIXTURE_METHOD_KEYS) {
    const engine = new RuleEngine(presetCharter(FIXTURE_METHODS[method], truth.language));
    const predictions: Prediction[] = snapshot.notes.map((note) => {
      const placement = engine.evaluate(note);
      if (placement.status === 'ruled') return { path: note.path, destination: placement.destination.id, confidence: 1, decidedBy: 'rules' };
      if (placement.status === 'system' && placement.role === 'daily') return { path: note.path, destination: DAILY, confidence: 1, decidedBy: 'rules' };
      return { path: note.path, destination: null, confidence: 0, decidedBy: null };
    });
    const expected = new Map(Object.entries(truth.notes).map(([path, note]) => [path, note.destinations[method].id]));
    result[method] = classificationMetrics(predictions, expected);
  }
  return result;
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
