import { describe, expect, it } from 'vitest';
import { acceptedOp, applyHarness, planOf } from '../testing/apply-harness';
import { BackupService } from './backup';
import { PlanStore } from './plan-store';
import { ApplyRunService } from './run';
import { UndoService } from './undo';

function setup(files: Record<string, string>) {
  const harness = applyHarness(files);
  const deps = { ...harness.deps, storage: harness.storage, clock: harness.clock };
  return { ...harness, service: new ApplyRunService(deps), backups: new BackupService(deps), undo: new UndoService(deps) };
}

describe('ApplyRunService', () => {
  it('validates, backs up, applies with verification and reports statuses', async () => {
    const { service, vault, backups, journal } = setup({ 'Inbox/Idea.md': 'x', 'Home.md': '[[Inbox/Idea]]' });
    const phases: string[] = [];
    const move = acceptedOp({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/Idea.md' });
    const outcome = await service.run(planOf([move]), { pluginVersion: '0.1.0', onPhase: (p) => phases.push(p) });

    expect(phases).toEqual(['validating', 'backing-up', 'applying']);
    expect(outcome.kind).toBe('ran');
    if (outcome.kind !== 'ran') return;
    expect(outcome.report.status).toBe('completed');
    expect(outcome.plan.operations[0]?.status).toBe('applied');
    expect(await vault.read('Home.md')).toBe('[[Idea]]');
    expect(await backups.list()).toEqual([outcome.backup.key]);
    expect((await journal.read(outcome.report.runId)).run.backupKey).toBe(outcome.backup.key);
    expect((await backups.inspect(outcome.backup.key)).files.get('Home.md')).toEqual(new TextEncoder().encode('[[Inbox/Idea]]'));
  });

  it('writes nothing, not even a backup, when validation fails', async () => {
    const { service, vault, storage } = setup({ 'a.md': 'x' });
    const before = vault.contents();
    const outcome = await service.run(planOf([acceptedOp({ kind: 'move', from: 'missing.md', to: 'b.md' })]), {
      pluginVersion: '0.1.0',
    });
    expect(outcome.kind).toBe('invalid');
    expect(vault.contents()).toEqual(before);
    expect(await storage.list('')).toEqual([]);
  });

  it('stops on broken links and the run can be undone', async () => {
    const { service, vault, undo } = setup({ 'Inbox/Idea.md': 'x', 'Home.md': '[[Inbox/Idea]]' });
    vault.updateLinksOnMove = false;
    const before = vault.contents();
    const outcome = await service.run(planOf([acceptedOp({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/Idea.md' })]), {
      pluginVersion: '0.1.0',
    });
    expect(outcome.kind === 'ran' && outcome.report.status).toBe('verification-failed');
    await undo.undoLast();
    expect(vault.contents()).toEqual(before);
  });

  it('respects destinations and keeps only the configured number of backups', async () => {
    const { service, backups } = setup({ 'a.md': 'x', 'b.md': 'y' });
    const invalid = await service.run(planOf([acceptedOp({ kind: 'move', from: 'a.md', to: 'Elsewhere/a.md' })]), {
      pluginVersion: '0.1.0',
      allowedRoots: ['Projects'],
    });
    expect(invalid.kind === 'invalid' && invalid.validation.issues[0]?.code).toBe('outside-destinations');

    for (const name of ['a', 'b']) {
      await service.run(planOf([acceptedOp({ kind: 'setProperty', path: `${name}.md`, key: 'k', value: 1 })], `p-${name}`), {
        pluginVersion: '0.1.0',
        retention: 1,
      });
    }
    expect(await backups.list()).toHaveLength(1);
  });
});

describe('PlanStore', () => {
  it('saves plans, loads them validated and finds the latest', async () => {
    const { storage } = setup({});
    const store = new PlanStore(storage);
    const older = { ...planOf([], 'older'), createdAt: '2026-10-01T00:00:00.000Z' };
    const newer = { ...planOf([acceptedOp({ kind: 'createFolder', path: 'X' })], 'newer/1'), createdAt: '2026-10-02T00:00:00.000Z' };
    await store.save(older);
    expect(await store.save(newer)).toBe('plans/newer-1.json');
    await storage.write('plans/broken.json', new TextEncoder().encode('{nope'));

    expect((await store.latest())?.id).toBe('newer/1');
    expect(await store.load('older')).toEqual({ ok: true, value: older });
    expect(await store.load('missing')).toEqual({ ok: false, error: ['No plan file plans/missing.json'] });
  });
});
