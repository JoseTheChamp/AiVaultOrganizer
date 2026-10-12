// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { OperationPreview } from '../../core/apply/preview';
import { presetCharter } from '../../core/charter/presets/index';
import { createOperation } from '../../core/model/operation';
import { createPlan, type Plan } from '../../core/model/plan';
import { reactive } from '../reactive.svelte';
import PlanReview from './PlanReview.svelte';
import { type ReviewActions, type ReviewModel, reviewItems } from './review-state';

const move = createOperation({ kind: 'move', from: 'Plan.md', to: '1 Projects/Website/Plan.md' }, { source: 'knn', confidence: 0.9, rationale: 'Like the website notes.' });
const rename = createOperation({ kind: 'renameProperty', path: '1 Projects/Website/Plan.md', from: 'Type', to: 'type' }, { source: 'rule', confidence: 1, dependsOn: [move.id] });
const unsure = createOperation({ kind: 'move', from: 'Old.md', to: '4 Archive/Old.md' }, { source: 'llm', confidence: 0.39 });
const flag = createOperation({ kind: 'flag', path: 'Odd.md', issue: 'ambiguous' }, { confidence: 0, rationale: 'No rule, similar notes or model could place it.' });
const plan = createPlan({
  id: 'p',
  createdAt: '2026-10-07T00:00:00.000Z',
  operations: [move, rename, unsure, flag],
  summary: { summary: 'This plan moves 2 notes.', highlights: ['1 note could not be placed.'], source: 'rules' },
});

function setup(overrides: Partial<Omit<ReviewModel, 'apply'>> & { apply?: ReviewModel['apply'] } = {}) {
  const validation = { ok: true, issues: [], staleOpIds: [] };
  const model = reactive<ReviewModel>({ plan, items: reviewItems(plan, validation, presetCharter('para', 'en')), validation, linksAutoUpdateOff: false, busy: false, threshold: 0.8, aiReady: true, apply: null, ...overrides });
  const actions = {
    preview: vi.fn<(op: typeof move) => Promise<OperationPreview>>().mockResolvedValue({ kind: 'move', from: 'Plan.md', to: '1 Projects/Website/Plan.md' }),
    save: vi.fn<(plan: Plan) => void>(),
    apply: vi.fn<(plan: Plan) => void>(),
    openNote: vi.fn<(path: string) => void>(),
    cancelApply: vi.fn<() => void>(),
    undoRun: vi.fn<() => void>(),
    closeApply: vi.fn<() => void>(),
    learn: vi.fn<(plan: Plan) => void>(),
    setUpAi: vi.fn<() => void>(),
  } satisfies ReviewActions;
  render(PlanReview, { model, actions });
  return { model, actions };
}

const applyButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Apply/ });

describe('PlanReview', () => {
  it('shows the summary and the groups, flags first', () => {
    setup();
    expect(screen.getByText('This plan moves 2 notes.')).toBeTruthy();
    const groups = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(groups).toEqual(['Needs your attention', 'Moves into 1 Projects', 'Moves into 4 Archive', 'Property renames']);
    expect(applyButton().disabled).toBe(true);
  });

  it('shows a highlight that repeats a warning once, instead of failing to render', () => {
    const warning = '16 notes fit no folder for sure, so they go to Other.';
    const repeated = { ...plan, warnings: [{ code: 'fallback', message: warning, opIds: [] }], summary: { summary: 'This plan moves 2 notes.', highlights: [warning], source: 'model' as const } };
    setup({ plan: repeated, items: reviewItems(repeated, { ok: true, issues: [], staleOpIds: [] }, presetCharter('para', 'en')) });
    expect(screen.getAllByText(warning)).toHaveLength(1);
  });

  it('bulk-accepts at the threshold, saves, and applies the decided plan', async () => {
    const { actions } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Accept 2 changes' }));
    expect(actions.save).toHaveBeenCalledOnce();
    expect(applyButton().textContent).toContain('Apply 2 accepted changes');
    await fireEvent.click(applyButton());
    const applied = actions.apply.mock.calls[0]?.[0];
    expect(applied?.operations.map((op) => op.status)).toEqual(['accepted', 'accepted', 'pending', 'pending']);
  });

  it('decides with the keyboard: a accepts and moves on, r rejects', async () => {
    const { actions } = setup();
    const rows = screen.getAllByRole('button', { name: /^Move|^Rename|^Flag/ });
    const first = rows.find((row) => row.textContent?.includes('Plan.md'));
    first?.focus();
    await fireEvent.keyDown(first as HTMLElement, { key: 'a' });
    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'r' });
    const last = actions.save.mock.calls.at(-1)?.[0];
    expect(last?.operations.find((op) => op.id === move.id)?.status).toBe('accepted');
    expect(last?.operations.find((op) => op.id === unsure.id)?.status).toBe('rejected');
  });

  it('rejecting a move also rejects the edit that needs it', async () => {
    const { actions } = setup();
    const row = screen.getByRole('region', { name: 'Moves into 1 Projects' });
    await fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    const saved = actions.save.mock.calls.at(-1)?.[0];
    expect(saved?.operations.find((op) => op.id === rename.id)?.status).toBe('rejected');
  });

  it('keeps a change rejected now in place, so the reviewer sees what happened', async () => {
    setup();
    await fireEvent.click(within(screen.getByRole('region', { name: 'Moves into 4 Archive' })).getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('region', { name: 'Moves into 4 Archive' })).toBeTruthy();
    expect(screen.queryByText(/^Rejected \(/)).toBeNull();
  });

  it('shows changes rejected earlier folded at the end, where they can still be taken back', async () => {
    const earlier = { ...plan, operations: plan.operations.map((op) => (op.id === unsure.id ? { ...op, status: 'rejected' as const } : op)) };
    setup({ plan: earlier, items: reviewItems(earlier, { ok: true, issues: [], staleOpIds: [] }, presetCharter('para', 'en')) });
    expect(screen.queryByRole('region', { name: 'Moves into 4 Archive' })).toBeNull();
    const folded = screen.getByText(/^Rejected \(1\)/).closest('details') as HTMLElement;
    expect(folded.hasAttribute('open')).toBe(false);
    await fireEvent.click(within(folded).getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('region', { name: 'Moves into 4 Archive' })).toBeTruthy();
    expect(screen.queryByText(/^Rejected \(/)).toBeNull();
  });

  it('shows rejected changes in their groups when filtered for them', async () => {
    setup();
    await fireEvent.click(within(screen.getByRole('region', { name: 'Moves into 4 Archive' })).getByRole('button', { name: 'Reject' }));
    await fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'rejected' } });
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Moves into 4 Archive']);
    expect(screen.queryByText(/^Rejected \(/)).toBeNull();
  });

  it('loads a preview when a row opens', async () => {
    const { actions } = setup();
    const row = screen.getByRole('region', { name: 'Moves into 1 Projects' });
    await fireEvent.click(within(row).getByRole('button', { name: /Move "Plan.md"/ }));
    expect(actions.preview).toHaveBeenCalledWith(move);
    expect(await within(row).findByText('1 Projects/Website/Plan.md')).toBeTruthy();
  });

  it('asks for an explicit OK when Obsidian will not update links', async () => {
    setup({ linksAutoUpdateOff: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Accept 2 changes' }));
    expect(applyButton().disabled).toBe(true);
    await fireEvent.click(screen.getByRole('checkbox', { name: /Apply anyway/ }));
    expect(applyButton().disabled).toBe(false);
  });

  it('filters by source and confidence', async () => {
    setup();
    await fireEvent.change(screen.getByRole('combobox', { name: 'Decided by' }), { target: { value: 'llm' } });
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Moves into 4 Archive']);
  });

  it('learns from decisions once there are some, and with something left to decide', async () => {
    const { actions } = setup();
    const learn = screen.getByRole<HTMLButtonElement>('button', { name: 'Learn from my decisions' });
    expect(learn.disabled).toBe(true);
    const row = screen.getByRole('region', { name: 'Moves into 1 Projects' });
    await fireEvent.click(within(row).getByRole('button', { name: 'Accept' }));
    expect(learn.disabled).toBe(false);
    await fireEvent.click(learn);
    expect(actions.learn.mock.calls[0]?.[0].operations.find((op) => op.id === move.id)?.status).toBe('accepted');
  });

  it('offers AI for the notes it could not place, only when AI is off', async () => {
    const { actions } = setup({ aiReady: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Set up AI to place them' }));
    expect(actions.setUpAi).toHaveBeenCalledOnce();
  });

  it('shows the reason only when a row is opened', async () => {
    setup();
    expect(screen.queryByText(/Like the website notes/)).toBeNull();
    const row = screen.getByRole('region', { name: 'Moves into 1 Projects' });
    await fireEvent.click(within(row).getByRole('button', { name: /Move "Plan.md"/ }));
    expect(within(row).getByText('Why: Like the website notes.')).toBeTruthy();
  });
});
