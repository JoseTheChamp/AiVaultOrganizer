import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets/index';
import { validatePlan } from '../apply/validate';
import { UndoService } from '../apply/undo';
import { applyHarness } from '../testing/apply-harness';
import { buildRulePlan, charterRoots } from './rule-plan';

const charter = presetCharter('para', 'en');
const now = new Date('2026-10-05T12:00:00Z');

const files = {
  'Vault Charter.md': '---\ncharter: true\n---\n',
  'Website.md': '---\ntype: project\n---\nSee [[Old project]].',
  'Old project.md': '---\ntype: project\nstatus: done\n---\n',
  '2026-10-04.md': 'Daily entry, links [[Website]].',
  'Loose.md': '',
  '0 Inbox/Idea.md': '',
  '3 Resources/Pasta.md': '---\ntype: resource\n---\n',
  '1 Projects/Website/Website.md': '---\ntype: project\n---\nexisting',
  'Duplicate.md': '---\ntype: resource\n---\n',
  '3 Resources/Duplicate.md': '',
};

describe('buildRulePlan', () => {
  it('proposes moves, folders and flags from rules alone', async () => {
    const { vault } = applyHarness(files);
    const plan = buildRulePlan(await vault.snapshot(), charter, { charterPath: 'Vault Charter.md', now, createMissingFolders: true });

    expect(plan.id).toBe('rules-20261005T120000');
    expect(plan.operations.map((op) => [op.kind, 'from' in op ? `${op.from} → ${op.to}` : op.path])).toEqual([
      ['createFolder', '2 Areas'],
      ['createFolder', '4 Archive'],
      ['createFolder', 'Daily'],
      ['move', '2026-10-04.md → Daily/2026-10-04.md'],
      ['flag', 'Duplicate.md'],
      ['move', 'Old project.md → 4 Archive/Old project.md'],
      ['flag', 'Website.md'],
    ]);
    const move = plan.operations.find((op) => op.kind === 'move' && op.from === 'Old project.md');
    expect(move).toMatchObject({ source: 'rule', confidence: 1, status: 'pending', precondition: { path: 'Old project.md' } });
    expect(move?.rationale).toBe('Rule "status: done | archived" places it in archive ("4 Archive").');
    expect(plan.warnings.map((w) => w.code)).toEqual(['unplaced', 'inbox']);
  });

  it('produces a plan that validates, applies and undoes cleanly', async () => {
    const { vault, executor, deps } = applyHarness(files);
    const before = vault.contents();
    const plan = buildRulePlan(await vault.snapshot(), charter, { charterPath: 'Vault Charter.md', now, createMissingFolders: true });
    const accepted = { ...plan, operations: plan.operations.map((op) => ({ ...op, status: 'accepted' as const })) };

    const validation = validatePlan(accepted, { snapshot: await vault.snapshot(), allowedRoots: charterRoots(charter), ignore: charter.ignore });
    expect(validation.issues).toEqual([]);
    const report = await executor.apply(accepted);
    expect(report).toMatchObject({ status: 'completed', applied: 5 });
    expect(await vault.exists('4 Archive/Old project.md')).toBe(true);
    expect(await vault.read('Website.md')).toBe('---\ntype: project\n---\nSee [[Old project]].');

    await new UndoService(deps).undoLast();
    expect(vault.contents()).toEqual(before);
  });

  it('is empty for a vault that already follows its charter', async () => {
    const { vault } = applyHarness({ '1 Projects/A/A.md': '---\ntype: project\n---\n', 'Daily/2026-10-01.md': '' }, ['0 Inbox', '2 Areas', '3 Resources', '4 Archive']);
    const plan = buildRulePlan(await vault.snapshot(), charter, { charterPath: null, now, createMissingFolders: true });
    expect(plan.operations).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('adds categories in properties mode', async () => {
    const flat = presetCharter('flat-categories', 'en');
    const withRecipes = { ...flat, destinations: [...flat.destinations, { id: 'recipes', category: '[[Recipes]]', description: '', layout: 'flat' as const, priority: 0, match: [{ property: 'type', equals: 'recipe' }], examples: [] }] };
    const { vault } = applyHarness({ 'Soup.md': '---\ntype: recipe\ncategories: "[[Food]]"\n---\n' });
    const plan = buildRulePlan(await vault.snapshot(), withRecipes, { charterPath: null, now });
    expect(plan.operations).toMatchObject([{ kind: 'setProperty', path: 'Soup.md', key: 'categories', value: ['[[Food]]', '[[Recipes]]'] }]);
  });
});
