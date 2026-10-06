// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { analyzeVault } from '../../core/analysis/analyze';
import type { Charter } from '../../core/charter/schema';
import { presetCharter } from '../../core/charter/presets/index';
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

describe('SetupWizard', () => {
  it('walks from diagnosis to a customized charter and hands it back', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    expect(screen.getByText(/Health:/)).toBeTruthy();

    await next();
    const para = screen.getByRole('radio', { name: /^PARA/ });
    expect((para as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(screen.getByRole('radio', { name: /^ACE/ }));
    await fireEvent.click(para);

    await next();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder for resources' }), { target: { value: 'Library' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use 4 Archive' }));
    expect(screen.getByText(/With this charter/)).toBeTruthy();

    await next();
    const preview = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Charter note preview' });
    expect(preview.value).toContain('path: Library');
    await fireEvent.click(screen.getByRole('checkbox', { name: /Plan where every note belongs/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));

    const [charter, planNow] = submit.mock.calls[0] ?? [];
    expect(charter?.destinations.map((d) => d.path)).toEqual(['1 Projects', '2 Areas', 'Library']);
    expect(planNow).toBe(false);
  });

  it('blocks the next step while the changes do not make a charter', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    await next();
    await next();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder for areas' }), { target: { value: '1 Projects' } });
    expect(screen.getByRole('alert').textContent).toContain('"1 Projects" is used by two destinations');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true);
  });

  it('offers a draft from the language model and starts from it', async () => {
    const wizard = await input();
    const draft: Charter = { ...presetCharter('para', 'en'), destinations: presetCharter('para', 'en').destinations.slice(0, 2) };
    const requestDraft = vi.fn<(lang: 'en' | 'cs', wish: string) => Promise<Charter | null>>().mockResolvedValue(draft);
    render(SetupWizard, { input: wizard, submit: vi.fn(), cancel: vi.fn(), requestDraft });
    await next();
    await fireEvent.input(screen.getByRole('textbox', { name: /Anything it should know/ }), { target: { value: ' keep it small ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Ask for a draft' }));
    await vi.waitFor(() => expect(screen.getByRole<HTMLInputElement>('radio', { name: /^AI draft/ }).checked).toBe(true));
    expect(requestDraft).toHaveBeenCalledWith('en', 'keep it small');
    expect(screen.getByText(/Based on PARA, with 1 Projects, 2 Areas/)).toBeTruthy();
    await next();
    expect(screen.queryByRole('textbox', { name: 'Folder for resources' })).toBeNull();
  });

  it('has no draft button without a language model', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    await next();
    expect(screen.queryByRole('button', { name: 'Ask for a draft' })).toBeNull();
  });

  it('moves focus to each new step, so screen readers announce it', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    await next();
    expect(document.activeElement?.textContent).toBe('Step 2 of 4: Method');
  });
});
