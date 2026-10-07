// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { analyzeVault } from '../../core/analysis/analyze';
import { presetCharter } from '../../core/charter/presets/index';
import type { Charter } from '../../core/charter/schema';
import { InMemoryVault } from '../../core/testing/in-memory-vault';
import SetupWizard from './SetupWizard.svelte';
import type { WizardInput } from './wizard-state';

async function input(): Promise<WizardInput> {
  const snapshot = await InMemoryVault.from({
    '1 Projects/Website/Website.md': '---\ntype: project\n---\nRelaunch.',
    '2 Areas/Health/Health.md': '---\ntype: area\n---\nRunning.',
    '3 Resources/Cooking/Bread.md': 'Sourdough.',
    'Loose idea.md': 'Something.',
  }).snapshot();
  return { snapshot, analysis: analyzeVault(snapshot, { now: Date.UTC(2026, 9, 7) }), existing: null, replacesInvalid: false, charterPath: 'Vault Charter.md' };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const preview = () => screen.getByRole('region', { name: /in your vault|Preview/ });

describe('SetupWizard', () => {
  it('shows the chosen system as folders fitted to the vault, with what it is good for', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^PARA/ }).checked).toBe(true);
    const tree = within(preview());
    expect(tree.getByText('1 Projects')).toBeTruthy();
    expect(tree.getByText('Website')).toBeTruthy();
    expect(tree.getByText(/3 of 4 notes fit by its rules/)).toBeTruthy();
    expect(tree.getByText('About PARA')).toBeTruthy();
    expect(tree.getByText('Many projects that start and finish')).toBeTruthy();

    await fireEvent.click(screen.getByRole('radio', { name: /^ACE/ }));
    expect(within(preview()).getByText('Atlas')).toBeTruthy();
  });

  it('adjusts folders with a live preview and hands the charter back', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    await next();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder for resources' }), { target: { value: 'Library' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use 4 Archive' }));
    expect(within(preview()).getByText('Library')).toBeTruthy();
    expect(within(preview()).queryByText('4 Archive')).toBeNull();

    await next();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Charter note preview' }).value).toContain('path: Library');
    await fireEvent.click(screen.getByRole('checkbox', { name: /Then plan where my notes go/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));
    const [charter, planNow] = submit.mock.calls[0] ?? [];
    expect(charter?.destinations.map((d) => d.path)).toEqual(['1 Projects', '2 Areas', 'Library']);
    expect(planNow).toBe(false);
  });

  it('blocks the next step while the changes do not make a charter', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    await next();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder for areas' }), { target: { value: '1 Projects' } });
    expect(screen.getByRole('alert').textContent).toContain('"1 Projects" is used by two destinations');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true);
  });

  it('suggests a system with AI and starts from it', async () => {
    const draft: Charter = { ...presetCharter('para', 'en'), destinations: presetCharter('para', 'en').destinations.slice(0, 2) };
    const requestDraft = vi.fn<(lang: 'en' | 'cs', wish: string) => Promise<Charter | null>>().mockResolvedValue(draft);
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn(), requestDraft });
    await fireEvent.input(screen.getByRole('textbox', { name: 'A wish for the suggestion' }), { target: { value: ' keep it small ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Suggest a system' }));
    await vi.waitFor(() => expect(screen.getByRole<HTMLInputElement>('radio', { name: /^Suggested by AI/ }).checked).toBe(true));
    expect(requestDraft).toHaveBeenCalledWith('en', 'keep it small');
    expect(within(preview()).queryByText('3 Resources')).toBeNull();
  });

  it('moves focus to each new step, so screen readers announce it', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    await next();
    expect(document.activeElement?.textContent).toBe('Step 2 of 3: Adjust');
  });
});
