// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { RunReport } from '../../core/apply/executor';
import { createOperation } from '../../core/model/operation';
import { createPlan } from '../../core/model/plan';
import { reactive } from '../reactive.svelte';
import ApplyProgress from './ApplyProgress.svelte';
import { type ApplyState, runReportState } from './run-report';

const moved = createOperation({ kind: 'move', from: 'A.md', to: 'P/A.md' }, { status: 'accepted' });
const skipped = createOperation({ kind: 'setProperty', path: 'B.md', key: 'type', value: 'note' }, { status: 'accepted' });
const plan = createPlan({ id: 'p', createdAt: '2026-10-07T00:00:00.000Z', operations: [moved, skipped] });
const report: RunReport = {
  runId: 'r1',
  planId: 'p',
  status: 'completed',
  applied: 1,
  skipped: 1,
  failed: 0,
  results: [
    { opId: moved.id, status: 'applied' },
    { opId: skipped.id, status: 'skipped', reason: '"B.md" changed since the plan was made.' },
  ],
};

describe('runReportState', () => {
  it('counts, explains what did not apply, and knows whether there is anything to undo', () => {
    const state = runReportState({ report, plan, backupKey: 'backups/2026-10-07.zip', health: { before: 61, after: 74 } });
    expect(state).toMatchObject({ title: 'Changes applied', counts: '1 change applied, 1 skipped, 0 failed.', backup: '.ai-vault-organizer/backups/2026-10-07.zip', undoable: true });
    expect(state.problems).toEqual(['Set "type" to "note" in "B.md": "B.md" changed since the plan was made.']);
    expect(runReportState({ report: { ...report, applied: 0 }, plan, backupKey: 'x' }).undoable).toBe(false);
  });
});

describe('ApplyProgress', () => {
  it('shows progress, cancels during apply, then reports with undo', async () => {
    const state = reactive<ApplyState>({ phase: 'backing-up', done: 0, total: 0, cancelling: false, report: null, invalid: null });
    const actions = { cancel: vi.fn<() => void>(), undo: vi.fn<() => void>(), close: vi.fn<() => void>() };
    render(ApplyProgress, { state, ...actions });
    expect(screen.getByText('Creating a backup…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);

    Object.assign(state, { phase: 'applying', done: 3, total: 10 });
    flushSync();
    expect(screen.getByText('3 of 10')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.cancel).toHaveBeenCalledOnce();

    state.report = runReportState({ report, plan, backupKey: 'backups/b.zip', health: { before: 61, after: 74 } });
    flushSync();
    expect(screen.getByText('Changes applied')).toBeTruthy();
    expect(screen.getByText('Health, was 61')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Undo this run' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(actions.undo).toHaveBeenCalledOnce();
    expect(actions.close).toHaveBeenCalledOnce();
  });

  it('says why nothing was changed when the plan is invalid', () => {
    render(ApplyProgress, { state: { phase: 'done', done: 0, total: 0, cancelling: false, report: null, invalid: ['"P/A.md" already exists.'] }, cancel: vi.fn(), undo: vi.fn(), close: vi.fn() });
    expect(screen.getByText('The plan cannot be applied')).toBeTruthy();
    expect(screen.getByText('"P/A.md" already exists.')).toBeTruthy();
  });
});
