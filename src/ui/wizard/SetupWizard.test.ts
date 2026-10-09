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

  it("names folders in the vault's language, without asking", async () => {
    const snapshot = await InMemoryVault.from({
      'Poznámky k projektu.md': 'Je to plán, který se týká rekonstrukce a stěhování do bytu.',
      'Nápady na víkend.md': 'Výlet na hory, nebo do lázní? Ještě není jasné, kdy pojedeme.',
    }).snapshot();
    const czech: WizardInput = { snapshot, analysis: analyzeVault(snapshot, { now: Date.UTC(2026, 9, 7) }), existing: null, replacesInvalid: false, charterPath: 'Vault Charter.md' };
    render(SetupWizard, { input: czech, submit: vi.fn(), cancel: vi.fn() });
    await fireEvent.click(screen.getByRole('radio', { name: /^PARA/ }));
    expect(within(preview()).getByText('1 Projekty')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Folder names/ })).toBeNull();
  });

  it('adjusts folders with a live preview and hands the charter back', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    await next();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder for resources' }), { target: { value: 'Library' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove 4 Archive' }));
    expect(within(preview()).getByText('Library')).toBeTruthy();
    expect(within(preview()).queryByText('4 Archive')).toBeNull();

    await next();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Charter note preview' }).value).toContain('path: Library');
    await fireEvent.click(screen.getByRole('checkbox', { name: /Then plan where my notes go/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));
    const [charter, planNow] = submit.mock.calls[0] ?? [];
    expect(charter?.destinations.map((d) => d.path)).toEqual(['1 Projects', '2 Areas', 'Library', 'Other']);
    expect(planNow).toBe(false);
  });

  it('says what each folder is for, and what a folder it reuses already holds', async () => {
    render(SetupWizard, { input: await input(), submit: vi.fn(), cancel: vi.fn() });
    await next();
    const resources = screen.getByRole('textbox', { name: 'Folder for resources' });
    const row = within(resources.closest('.avo-folder') as HTMLElement);
    expect(row.getByText(/reference material/)).toBeTruthy();
    expect(row.getByText('Your folder already holds 1 note: Bread.')).toBeTruthy();
    // Every method comes with Other, for notes nothing else fits.
    const other = screen.getByRole<HTMLInputElement>('textbox', { name: 'Folder for other' });
    expect(other.value).toBe('Other');
    expect(within(other.closest('.avo-folder') as HTMLElement).getByText(/fit no other folder/)).toBeTruthy();
    // Naming a folder the vault does not have shows nothing about it.
    await fireEvent.input(resources, { target: { value: 'Library' } });
    expect(row.queryByText(/already holds/)).toBeNull();
  });

  it('adds folders of your own and takes back removed ones', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    await fireEvent.click(screen.getByRole('radio', { name: /^Johnny\.Decimal/ }));
    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a folder' }));
    const folder = screen.getByRole<HTMLInputElement>('textbox', { name: 'New folder' });
    // At the top level the example is a new area with its first category; a path is fine there.
    expect(folder.placeholder).toBe('e.g. 40-49 Hobbies/41 Sport');
    await fireEvent.input(folder, { target: { value: '10-19 Life admin/14 Sport' } });
    // A folder without a description gives AI nothing to go on.
    expect(screen.getByRole('alert').textContent).toContain('Say what goes into "10-19 Life admin/14 Sport"');
    await fireEvent.input(screen.getByRole('textbox', { name: 'What goes into 10-19 Life admin/14 Sport' }), { target: { value: 'Running, races and training plans.' } });
    expect(within(preview()).getByText('14 Sport')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove 30-39 Learning/32 Books' }));
    expect(within(preview()).queryByText('32 Books')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Add back 30-39 Learning/32 Books' }));
    expect(within(preview()).getByText('32 Books')).toBeTruthy();

    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));
    const [charter] = submit.mock.calls[0] ?? [];
    expect(charter?.destinations.find((d) => d.path === '10-19 Life admin/14 Sport')).toMatchObject({ id: '14-sport', description: 'Running, races and training plans.', match: [{ filename: '^14\\.\\d{2}(?:\\s|$)' }] });
    expect(charter?.jd?.areas.find((area) => area.id === '10-19')?.categories.map((c) => c.id)).toEqual(['11', '12', '13', '14']);
  });

  it('adds a folder inside an area or another folder, its path already started', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    await fireEvent.click(screen.getByRole('radio', { name: /^Johnny\.Decimal/ }));
    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a folder in 10-19 Life admin' }));
    const folder = screen.getByRole<HTMLInputElement>('textbox', { name: 'New folder' });
    // Only the name is edited; the tree shows where the folder is.
    expect(folder.value).toBe('14 ');
    expect(document.activeElement).toBe(folder);
    await fireEvent.input(folder, { target: { value: '14 Sport' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'What goes into 10-19 Life admin/14 Sport' }), { target: { value: 'Running and races.' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Add a subfolder to 20-29 Work/21 Projects' }));
    expect(screen.getAllByRole<HTMLInputElement>('textbox', { name: 'New folder' }).map((input) => input.value)).toEqual(['14 Sport', '']);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove the new folder in 20-29 Work/21 Projects' }));

    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));
    const [charter] = submit.mock.calls[0] ?? [];
    expect(charter?.destinations.map((d) => d.path)).toContain('10-19 Life admin/14 Sport');
    expect(charter?.destinations.some((d) => d.path?.startsWith('20-29 Work/21 Projects/'))).toBe(false);
  });

  it('adds subfolders to folders of your own, which then need no description', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a folder' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'New folder' }), { target: { value: 'Hobbies' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add a subfolder to Hobbies' }));
    const inner = screen.getAllByRole<HTMLInputElement>('textbox', { name: 'New folder' })[1];
    expect(inner?.value).toBe('');
    if (!inner) return;
    await fireEvent.input(inner, { target: { value: 'Running' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'What goes into Hobbies/Running' }), { target: { value: 'Running, races and training plans.' } });
    // Hobbies only holds Running now: its own description is optional.
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'What goes into Hobbies' }).placeholder).toMatch(/^Optional/);
    expect(screen.queryByRole('alert')).toBeNull();

    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));
    const paths = submit.mock.calls[0]?.[0].destinations.map((d) => d.path);
    expect(paths).toContain('Hobbies/Running');
    expect(paths).not.toContain('Hobbies');
  });

  it('opens on the current charter with folders found in the vault added, ready to organize', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    const existing = presetCharter('johnny-decimal', 'en');
    render(SetupWizard, { input: { ...(await input()), existing, found: ['10-19 Life admin/15 Travel'] }, submit, cancel: vi.fn() });
    expect(screen.getByRole('status').textContent).toContain('Found a new folder in your vault');
    const folder = screen.getByRole<HTMLInputElement>('textbox', { name: 'New folder' });
    expect(folder.value).toBe('15 Travel');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'What goes into 10-19 Life admin/15 Travel' }).value).toBe('Notes about Travel.');

    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Update charter' }));
    const [charter, planNow] = submit.mock.calls[0] ?? [];
    expect(charter?.destinations.find((d) => d.path === '10-19 Life admin/15 Travel')).toMatchObject({ match: [{ filename: '^15\\.\\d{2}(?:\\s|$)' }] });
    expect(planNow).toBe(true);
  });

  it('reorders folders among their siblings, with the arrow keys or by dragging', async () => {
    const submit = vi.fn<(charter: Charter, planNow: boolean) => void>();
    render(SetupWizard, { input: await input(), submit, cancel: vi.fn() });
    await next();
    const archive = screen.getByRole('button', { name: 'Move 4 Archive' });
    archive.focus();
    await fireEvent.keyDown(archive, { key: 'ArrowUp' });
    // The handle keeps the focus, so the folder can travel further.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move 4 Archive' }));

    const transfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };
    await fireEvent.dragStart(screen.getByRole('button', { name: 'Move Other' }), { dataTransfer: transfer });
    const projects = screen.getByRole('textbox', { name: 'Folder for projects' }).closest('.avo-folder') as HTMLElement;
    await fireEvent.dragOver(projects, { clientY: -1, dataTransfer: transfer });
    await fireEvent.drop(projects, { dataTransfer: transfer });

    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Create charter' }));
    expect(submit.mock.calls[0]?.[0].destinations.map((d) => d.path)).toEqual(['Other', '1 Projects', '2 Areas', '4 Archive', '3 Resources']);
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
