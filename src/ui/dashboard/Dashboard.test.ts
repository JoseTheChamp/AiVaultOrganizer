// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from '../reactive.svelte';
import Dashboard from './Dashboard.svelte';
import type { DashboardActions, DashboardModel, DashboardState } from './dashboard-state';

const state: DashboardState = {
  health: { score: 72, grade: 'fair', notes: 120 },
  charter: { status: 'ok', path: 'Vault Charter.md', method: 'PARA', revision: 2 },
  drift: { offCharter: 14, notes: 118, missingFolders: 0 },
  pending: { planId: 'p1', open: 9 },
  lastRun: null,
  canUndo: true,
  chat: { model: 'qwen3:8b', where: 'this computer', local: true },
  embeddings: { model: null, where: 'this computer', local: true },
};

function actions(): DashboardActions {
  return { refresh: vi.fn(), analyze: vi.fn(), setUp: vi.fn(), openCharter: vi.fn(), plan: vi.fn(), review: vi.fn(), undo: vi.fn() };
}

describe('Dashboard', () => {
  it('shows loading, then the state, and re-renders when the model changes', () => {
    const model = reactive<DashboardModel>({ state: null, error: null, busy: false });
    render(Dashboard, { model, actions: actions() });
    expect(screen.getByText('Reading the vault…')).toBeTruthy();

    model.state = state;
    flushSync();
    expect(screen.getByText('Health: Fair')).toBeTruthy();
    expect(screen.getByText('14 notes of 118 are off-charter.')).toBeTruthy();
    expect(screen.getByText('9 proposed changes wait for your review.')).toBeTruthy();
    expect(screen.getByText('Language model: qwen3:8b on this computer')).toBeTruthy();
    expect(screen.getByText('Better similarity: off (shared words)')).toBeTruthy();
  });

  it('wires the buttons and disables vault-changing ones while a run is busy', async () => {
    const model = reactive<DashboardModel>({ state, error: null, busy: false });
    const wired = actions();
    render(Dashboard, { model, actions: wired });
    await fireEvent.click(screen.getByRole('button', { name: 'Plan re-alignment' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(wired.plan).toHaveBeenCalledOnce();
    expect(wired.review).toHaveBeenCalledOnce();

    model.busy = true;
    flushSync();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Undo last run' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open charter' }).disabled).toBe(false);
  });

  it('offers to set up a charter when there is none', () => {
    const model = reactive<DashboardModel>({ state: { ...state, charter: { status: 'missing', path: 'Vault Charter.md' }, drift: null, pending: null }, error: null, busy: false });
    render(Dashboard, { model, actions: actions() });
    expect(screen.getByRole('button', { name: 'Set up charter' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plan re-alignment' })).toBeNull();
  });
});
