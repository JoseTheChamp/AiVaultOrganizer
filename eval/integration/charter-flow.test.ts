/**
 * End-to-end check of milestone 3's promise on a synthetic vault that drifted from PARA: create a
 * PARA charter, see drift, plan and apply the rule-based moves, see the drift resolved, and undo
 * everything back to a byte-identical vault. Runs the same core services the Obsidian commands use,
 * over an in-memory copy of fixtures/vaults/messy-para.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplyRunService } from '../../src/core/apply/run';
import { UndoService } from '../../src/core/apply/undo';
import { charterPlan } from '../../src/core/charter/charter-note';
import { adaptPresetToVault } from '../../src/core/charter/infer';
import { loadCharter } from '../../src/core/charter/load';
import { presetCharter } from '../../src/core/charter/presets/index';
import { computeDrift } from '../../src/core/drift/drift';
import type { Plan } from '../../src/core/model/plan';
import { charterRoots } from '../../src/core/planner/charter-roots';
import { buildPlan } from '../../src/core/planner/plan';
import { applyHarness } from '../../src/core/testing/apply-harness';
import { NodeFsVault } from '../adapters/node-vault';

const fixture = path.resolve(import.meta.dirname, '../../fixtures/vaults/messy-para');
const CHARTER = 'Vault Charter.md';
const accept = (plan: Plan): Plan => ({ ...plan, operations: plan.operations.map((op) => ({ ...op, status: 'accepted' as const })) });

async function loadFixture() {
  const disk = new NodeFsVault(fixture);
  const snapshot = await disk.snapshot();
  const files: Record<string, string> = {};
  for (const note of snapshot.notes) files[note.path] = await disk.read(note.path);
  return { files, folders: snapshot.folders };
}

describe('charter flow on the messy PARA fixture', () => {
  it('sets up a charter, re-aligns by rules and undoes everything exactly', async () => {
    const { files, folders } = await loadFixture();
    const harness = applyHarness(files, folders);
    const { vault, deps, storage, clock } = harness;
    const runs = new ApplyRunService({ ...deps, storage, clock });
    const undo = new UndoService(deps);
    const original = { contents: vault.contents(), folders: vault.folderPaths() };

    // 1. Set up charter: PARA fitted to the vault's own (unnumbered) folders.
    const charter = adaptPresetToVault(presetCharter('para', 'en'), await vault.snapshot());
    expect(charter.destinations.map((d) => d.path)).toEqual(['Projects', 'Areas', 'Resources', 'Archive']);
    expect([charter.inbox, charter.system.daily?.path, charter.system.templates]).toEqual(['Inbox', 'Journal', 'Templates']);
    const created = await runs.run(accept(charterPlan(charter, CHARTER, null, new Date(clock.now()))), { pluginVersion: 'test' });
    expect(created.kind === 'ran' && created.report.status).toBe('completed');
    const load = await loadCharter(vault, deps.hasher, CHARTER);
    expect(load.status).toBe('ok');

    // 2. Check drift.
    const before = computeDrift(await vault.snapshot(), charter, { charterPath: CHARTER, now: clock.now() });
    expect(before.counts.misplaced).toBe(5);
    expect(before.counts.unplaced).toBe(4);
    expect(before.missingFolders).toEqual(['Archive']);

    // 3. Plan re-alignment without AI (rules only) and apply it with the charter's constraints.
    const { plan } = await buildPlan({
      snapshot: await vault.snapshot(),
      charter,
      charterPath: CHARTER,
      read: (file) => vault.read(file),
      now: new Date(clock.now()),
      createDestinationFolders: true,
    });
    // Without AI, notes no rule places (the inbox note too) are flagged for the user, not guessed.
    expect(plan.operations.flatMap((op) => (op.kind === 'flag' && op.issue === 'ambiguous' ? [op.path] : []))).toEqual([
      'Home.md',
      'Inbox/Quick thought.md',
      'Meeting with Anna.md',
      'README.md',
      'Random note.md',
    ]);
    const moved = await runs.run(accept(plan), {
      pluginVersion: 'test',
      ignore: charter.ignore,
      allowedRoots: [...charterRoots(charter), CHARTER],
    });
    // Three folders and five moves; flags change nothing.
    expect(moved.kind === 'ran' && moved.report).toMatchObject({ status: 'completed', applied: 8, skipped: 0, failed: 0 });
    expect(await vault.exists('Archive/Kitchen renovation.md')).toBe(true);
    expect(await vault.exists('Projects/Website relaunch/Website relaunch.md')).toBe(true);
    expect(await vault.read('Templates/Project template.md')).toBe(files['Templates/Project template.md']);

    // 4. Drift is resolved except for notes only a person or the classifier can place.
    const after = computeDrift(await vault.snapshot(), charter, { charterPath: CHARTER, now: clock.now() });
    expect(after.counts.misplaced).toBe(0);
    expect(after.missingFolders).toEqual([]);
    expect(after.counts.unplaced).toBe(4);

    // 5. Undo the moves, then the charter's creation: back to the original vault, byte for byte.
    expect((await undo.undoLast())?.status).toBe('completed');
    expect((await undo.undoLast())?.status).toBe('completed');
    expect(vault.contents()).toEqual(original.contents);
    expect(vault.folderPaths()).toEqual(original.folders);
    expect(vault.trash.map((t) => t.path)).toEqual([CHARTER]);
  });
});
