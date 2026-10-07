import { describe, expect, it } from 'vitest';
import { analyzeVault } from '../../core/analysis/analyze';
import { presetCharter } from '../../core/charter/presets/index';
import { InMemoryVault } from '../../core/testing/in-memory-vault';
import { baseCharter, choiceOptions, initialChanges, recommendedChoice, type WizardInput } from './wizard-state';

async function input(files: Record<string, string>, existing: WizardInput['existing'] = null): Promise<WizardInput> {
  const snapshot = await InMemoryVault.from(files).snapshot();
  return { snapshot, analysis: analyzeVault(snapshot, { now: Date.UTC(2026, 9, 7) }), existing, replacesInvalid: false, charterPath: 'Vault Charter.md' };
}

const PARA_VAULT = {
  '1 Projects/Website/Website.md': '---\ntype: project\n---\nRelaunch.',
  '1 Projects/Website/Sitemap.md': 'Pages.',
  '2 Areas/Health/Health.md': '---\ntype: area\n---\nRunning.',
  '3 Resources/Cooking/Bread.md': 'Sourdough.',
  '4 Archive/Old.md': '---\nstatus: done\n---\nDone.',
  'Loose idea.md': 'Something.',
};

describe('wizard state', () => {
  it('recommends the detected method, or keeping the structure, or the charter being edited', async () => {
    expect(recommendedChoice(await input(PARA_VAULT))).toBe('para');
    expect(recommendedChoice(await input({ 'A.md': '', 'B.md': '' }))).toBe('codify');
    expect(recommendedChoice(await input(PARA_VAULT, presetCharter('ace', 'en')))).toBe('existing');
  });

  it('offers every method with how well the vault fits and what it suits', async () => {
    const options = choiceOptions(await input(PARA_VAULT));
    expect(options.map((option) => option.choice)).toEqual(['codify', 'para', 'ace', 'flat-categories', 'johnny-decimal', 'zettelkasten', 'topics']);
    const para = options.find((option) => option.choice === 'para');
    expect(para).toMatchObject({ recommended: true, label: 'PARA' });
    expect(para?.fit).toBeGreaterThan(0.5);
    expect(para?.about.origin).toBe('Tiago Forte');
    expect(para?.about.goodFor.length).toBeGreaterThan(0);
    expect(options.find((option) => option.choice === 'codify')?.about.notFor).toEqual(['A vault that is a mess today: it keeps the mess']);
  });

  it('starts from the charter being edited, so earlier changes survive', async () => {
    const existing = { ...presetCharter('para', 'en'), inbox: 'Inbox' };
    const wizard = await input(PARA_VAULT, existing);
    expect(baseCharter(wizard, 'existing', 'en')).toBe(existing);
    expect(initialChanges(existing)).toMatchObject({ inbox: 'Inbox', removed: [], tagStyle: 'keep' });
    // A preset is fitted to the vault: its numbered folders already exist.
    expect(baseCharter(wizard, 'para', 'en').destinations[0]?.path).toBe('1 Projects');
  });
});
