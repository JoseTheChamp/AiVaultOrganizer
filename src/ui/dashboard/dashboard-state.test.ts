import { describe, expect, it } from 'vitest';
import { aiSettingsSchema } from '../../core/ai/settings';
import type { JournalRun } from '../../core/apply/journal';
import { loadCharter } from '../../core/charter/load';
import { webCryptoHasher } from '../../core/hash';
import { createOperation } from '../../core/model/operation';
import { createPlan } from '../../core/model/plan';
import { InMemoryVault } from '../../core/testing/in-memory-vault';
import { dashboardState } from './dashboard-state';

const CHARTER = 'Vault Charter.md';
const ai = aiSettingsSchema.parse({});

async function state(files: Record<string, string>, extra: Partial<Parameters<typeof dashboardState>[0]> = {}) {
  const vault = InMemoryVault.from(files);
  return dashboardState({
    snapshot: await vault.snapshot(),
    charter: await loadCharter(vault, webCryptoHasher, CHARTER),
    lastRun: null,
    canUndo: false,
    pendingPlan: null,
    ai,
    now: Date.UTC(2026, 9, 7),
    ...extra,
  });
}

describe('dashboardState', () => {
  it('without a charter: health, no drift, nothing pending', async () => {
    const result = await state({ 'A.md': 'Hello [[B]].', 'B.md': 'World.' });
    expect(result.charter).toEqual({ status: 'missing', path: CHARTER });
    // A new vault without AI starts by connecting it.
    expect(result.next).toEqual({ kind: 'set-up-ai' });
    expect(result.drift).toBeNull();
    expect(result.health.notes).toBe(2);
    expect(result.pending).toBeNull();
    expect(result.chat).toEqual({ model: null, where: 'this computer', local: true });
  });

  it('with a charter: method, revision and notes off-charter', async () => {
    const charter = ['---', 'charter: true', '---', '```charter', 'version: 1', 'revision: 3', 'preset: para', 'language: en', 'mode: folders', 'destinations:', '  - id: projects', '    path: Projects', '    match: [{ property: type, equals: project }]', '```'].join('\n');
    const result = await state({ [CHARTER]: charter, 'Plan.md': '---\ntype: project\n---\n', 'Projects/Done.md': '---\ntype: project\n---\n' });
    expect(result.charter).toMatchObject({ status: 'ok', method: 'PARA', revision: 3 });
    expect(result.drift).toMatchObject({ offCharter: 1, notes: 2 });
    expect(result.next).toEqual({ kind: 'organize', notes: 1 });
  });

  it('says when notes wait in the fallback for a folder of their own', async () => {
    const charter = ['---', 'charter: true', '---', '```charter', 'version: 1', 'preset: custom', 'destinations:', '  - { id: projects, path: Projects }', '  - { id: other, path: Other, fallback: true }', '```'].join('\n');
    const result = await state({ [CHARTER]: charter, 'Projects/A.md': '', 'Other/B.md': '', 'Other/C.md': '' });
    expect(result.next).toEqual({ kind: 'waiting', notes: 2, where: 'Other' });
  });

  it('asks to add folders the user made in the system before reviewing a plan made without them', async () => {
    const charter = ['---', 'charter: true', '---', '```charter', 'version: 1', 'preset: custom', 'destinations:', '  - { id: finance, path: Life/Finance }', '```'].join('\n');
    const plan = createPlan({ id: 'p1', createdAt: '2026-10-07T00:00:00.000Z', operations: [createOperation({ kind: 'createFolder', path: 'X' }, { status: 'pending' })] });
    const result = await state({ [CHARTER]: charter, 'Life/Finance/Budget.md': '', 'Life/Travel/Japan.md': '' }, { pendingPlan: plan });
    expect(result.next).toEqual({ kind: 'new-folders', folders: ['Life/Travel'] });
  });

  it('counts open operations of a pending plan, and describes the last run and the models', async () => {
    const plan = createPlan({
      id: 'p1',
      createdAt: '2026-10-07T00:00:00.000Z',
      operations: [
        createOperation({ kind: 'createFolder', path: 'X' }, { status: 'pending' }),
        createOperation({ kind: 'createFolder', path: 'Y' }, { status: 'applied' }),
      ],
    });
    const lastRun: JournalRun = {
      run: { type: 'run', runId: 'r1', planId: 'p0', startedAt: '2026-10-06T10:00:00.000Z', backupKey: null, operationCount: 2 },
      ops: [],
      end: { type: 'end', status: 'completed', finishedAt: '2026-10-06T10:00:05.000Z', applied: 2, skipped: 0, failed: 0 },
      undo: { type: 'undo', at: '2026-10-06T11:00:00.000Z', restored: 2, conflicts: [] },
    };
    const cloud = { ...ai.chat, enabled: true, model: 'claude-haiku', baseUrl: 'https://api.anthropic.com/v1' };
    const result = await state({ 'A.md': '' }, { pendingPlan: plan, lastRun, canUndo: false, ai: { ...ai, chat: cloud } });
    expect(result.pending).toEqual({ planId: 'p1', open: 1 });
    expect(result.lastRun).toEqual({ at: '2026-10-06T10:00:05.000Z', status: 'completed', applied: 2, undone: true });
    expect(result.chat).toEqual({ model: 'claude-haiku', where: 'api.anthropic.com', local: false });
  });
});
