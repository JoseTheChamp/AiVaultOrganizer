// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from '../reactive.svelte';
import Dashboard from './Dashboard.svelte';
import type { DashboardActions, DashboardModel, DashboardState } from './dashboard-state';

const state: DashboardState = {
  next: { kind: 'review', changes: 9 },
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
  return { refresh: vi.fn(), analyze: vi.fn(), setUp: vi.fn(), openCharter: vi.fn(), plan: vi.fn(), review: vi.fn(), undo: vi.fn(), setUpAi: vi.fn() };
}

const next = () => within(screen.getByRole('region', { name: 'Next step' }));

describe('Dashboard', () => {
  it('shows loading, then one next step, and follows the model', () => {
    const model = reactive<DashboardModel>({ state: null, error: null, busy: false });
    render(Dashboard, { model, actions: actions() });
    expect(screen.getByText('Reading the vault…')).toBeTruthy();

    model.state = state;
    flushSync();
    expect(next().getByText('Review 9 proposed changes')).toBeTruthy();
    expect(screen.getByText('PARA')).toBeTruthy();
    expect(screen.getByText('qwen3:8b')).toBeTruthy();

    model.state = { ...state, next: { kind: 'organize', notes: 14 }, pending: null };
    flushSync();
    expect(next().getByText('14 notes are out of place')).toBeTruthy();
  });

  it('leads a new vault to choosing a system, and offers AI setup', async () => {
    const wired = actions();
    const model = reactive<DashboardModel>({
      state: { ...state, next: { kind: 'set-up-charter' }, charter: { status: 'missing', path: 'Vault Charter.md' }, drift: null, pending: null, chat: { model: null, where: 'this computer', local: true } },
      error: null,
      busy: false,
    });
    render(Dashboard, { model, actions: wired });
    await fireEvent.click(next().getByRole('button', { name: 'Choose a system' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(wired.setUp).toHaveBeenCalledOnce();
    expect(wired.setUpAi).toHaveBeenCalledOnce();
  });

  it('disables what changes the vault while a run is busy', () => {
    const model = reactive<DashboardModel>({ state, error: null, busy: true });
    render(Dashboard, { model, actions: actions() });
    expect(next().getByRole<HTMLButtonElement>('button', { name: 'Review' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open' }).disabled).toBe(false);
  });
});
