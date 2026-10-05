import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../testing/memory-storage';
import { Journal } from './journal';

function setup(start = Date.UTC(2026, 9, 5, 12, 0, 0)) {
  let now = start;
  const storage = new MemoryStorage();
  const journal = new Journal(storage, { now: () => (now += 1000) });
  return { storage, journal };
}

describe('Journal', () => {
  it('creates sortable run ids', () => {
    const { journal } = setup();
    const a = journal.newRunId('plan');
    const b = journal.newRunId('plan');
    expect(a).toMatch(/^20261005T120001Z-[0-9a-f]{6}$/);
    expect([b, a].sort()).toEqual([a, b]);
  });

  it('appends JSONL entries and reads a run back', async () => {
    const { storage, journal } = setup();
    const runId = 'r1';
    await journal.append(runId, { type: 'run', runId, planId: 'p', startedAt: 't', backupKey: null, operationCount: 1 });
    await journal.append(runId, {
      type: 'op',
      opId: 'op1',
      kind: 'setProperty',
      appliedAt: 't',
      inverses: [{ type: 'restoreContent', path: 'a.md', beforeContent: 'old', afterHash: 'h' }],
    });
    await journal.append(runId, { type: 'end', status: 'completed', finishedAt: 't', applied: 1, skipped: 0, failed: 0 });

    expect(storage.text('journal/r1.jsonl')?.split('\n')).toHaveLength(4);
    const run = await journal.read(runId);
    expect(run.run.planId).toBe('p');
    expect(run.ops[0]?.inverses[0]).toEqual({ type: 'restoreContent', path: 'a.md', beforeContent: 'old', afterHash: 'h' });
    expect(run.end?.status).toBe('completed');
    expect(run.undo).toBeNull();
  });

  it('refuses invalid entries on write and on read', async () => {
    const { storage, journal } = setup();
    // @ts-expect-error -- an unknown inverse type must be rejected at runtime too
    await expect(journal.append('r', { type: 'op', opId: 'x', kind: 'k', appliedAt: 't', inverses: [{ type: 'delete' }] })).rejects.toThrow();
    await storage.write('journal/bad.jsonl', new TextEncoder().encode('{"type":"run"}\n'));
    await expect(journal.read('bad')).rejects.toThrow('line 1 is invalid');
    await expect(journal.read('missing')).rejects.toThrow('No journal');
  });

  it('finds the newest run that can still be undone', async () => {
    const { journal } = setup();
    const header = (runId: string) => ({ type: 'run' as const, runId, planId: 'p', startedAt: 't', backupKey: null, operationCount: 1 });
    const op = { type: 'op' as const, opId: 'o', kind: 'createFolder', appliedAt: 't', inverses: [{ type: 'removeFolder' as const, path: 'F' }] };
    await journal.append('20260101T000000Z-aaaaaa', header('20260101T000000Z-aaaaaa'));
    await journal.append('20260101T000000Z-aaaaaa', op);
    await journal.append('20260102T000000Z-bbbbbb', header('20260102T000000Z-bbbbbb'));
    await journal.append('20260102T000000Z-bbbbbb', op);
    await journal.append('20260102T000000Z-bbbbbb', { type: 'undo', at: 't', restored: 1, conflicts: [] });
    await journal.append('20260103T000000Z-cccccc', header('20260103T000000Z-cccccc'));

    expect(await journal.runIds()).toEqual(['20260103T000000Z-cccccc', '20260102T000000Z-bbbbbb', '20260101T000000Z-aaaaaa']);
    expect((await journal.lastUndoableRun())?.run.runId).toBe('20260101T000000Z-aaaaaa');
  });
});
