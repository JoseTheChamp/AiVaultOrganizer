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
  return { refresh: vi.fn(), analyze: vi.fn(), setUp: vi.fn(), openCharter: vi.fn(), plan: vi.fn(), review: vi.fn(), undo: vi.fn(), setUpAi: vi.fn(), stop: vi.fn() };
}

function model(patch: Partial<DashboardModel> = {}): DashboardModel {
  return reactive<DashboardModel>({ state, error: null, busy: false, activity: null, aiStatus: { state: 'online', model: 'qwen3:8b', latencyMs: 12 }, ...patch });
}

const next = () => within(screen.getByRole('region', { name: 'Next step' }));

describe('Dashboard', () => {
  it('shows loading, then one next step, and follows the model', () => {
    const shown = model({ state: null });
    render(Dashboard, { model: shown, actions: actions() });
    expect(screen.getByText('Reading the vault…')).toBeTruthy();

    shown.state = state;
    flushSync();
    expect(next().getByText('Review 9 proposed changes')).toBeTruthy();
    expect(screen.getByText('PARA')).toBeTruthy();

    shown.state = { ...state, next: { kind: 'organize', notes: 14 }, pending: null };
    flushSync();
    expect(next().getByText('14 notes are out of place')).toBeTruthy();
  });

  it('starts a new vault by connecting AI, and lets you go on without it', async () => {
    const wired = actions();
    const off = { ...state, next: { kind: 'set-up-ai' as const }, charter: { status: 'missing' as const, path: 'Vault Charter.md' }, drift: null, pending: null, chat: { model: null, where: 'this computer', local: true } };
    render(Dashboard, { model: model({ state: off, aiStatus: { state: 'off' } }), actions: wired });
    expect(next().getByText('Start by connecting AI')).toBeTruthy();
    await fireEvent.click(next().getByRole('button', { name: 'Set up AI' }));
    await fireEvent.click(next().getByRole('button', { name: 'Continue without AI' }));
    expect(wired.setUpAi).toHaveBeenCalledOnce();
    expect(wired.setUp).toHaveBeenCalledOnce();
  });

  it('shows a task in progress with its count, and stops it', async () => {
    const wired = actions();
    const shown = model();
    render(Dashboard, { model: shown, actions: wired });
    shown.activity = { title: 'Organizing', detail: 'qwen3:8b is placing notes, step', done: 3, total: 12, stoppable: true };
    flushSync();
    const progress = within(screen.getByRole('region', { name: 'In progress' }));
    expect(progress.getByText('qwen3:8b is placing notes, step 3 of 12')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    await fireEvent.click(progress.getByRole('button', { name: 'Stop' }));
    expect(wired.stop).toHaveBeenCalledOnce();
  });

  it("lights the model's status and says how to fix it", () => {
    const shown = model({ aiStatus: { state: 'offline', message: 'Could not reach http://localhost:11434/v1.' } });
    render(Dashboard, { model: shown, actions: actions() });
    expect(screen.getByText(/Offline, on this computer/)).toBeTruthy();
    expect(screen.getByText(/The model does not answer/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fix' })).toBeTruthy();

    shown.aiStatus = { state: 'online', model: 'qwen3:8b', latencyMs: 12 };
    flushSync();
    expect(screen.getByText(/Online, on this computer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fix' })).toBeNull();
  });

  it('disables what changes the vault while a run is busy', () => {
    render(Dashboard, { model: model({ busy: true }), actions: actions() });
    expect(next().getByRole<HTMLButtonElement>('button', { name: 'Review' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Open' }).disabled).toBe(false);
  });
});
