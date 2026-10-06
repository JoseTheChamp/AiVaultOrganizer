import { describe, expect, it } from 'vitest';
import { ApplyRunService } from '../apply/run';
import { presetCharter } from '../charter/presets';
import type { Neighbor } from '../embeddings/top-k';
import { createPlan } from '../model/plan';
import { applyHarness } from '../testing/apply-harness';
import { classifyNotes, DAILY, isKindDestination, type LlmStage, ROOT } from './classify';
import { placementOperations, safeFolderName } from './placement-plan';
import { charterRoots } from './charter-roots';

const files = {
  'Vault Charter.md': '---\ncharter: true\n---\nCharter.',
  '1 Projects/Website relaunch/Website relaunch.md': '---\ntype: project\nstatus: active\n---\nHub.',
  '1 Projects/Website relaunch/Sitemap.md': 'Sitemap draft.',
  '2 Areas/Health/Check-up.md': 'Blood pressure fine.',
  'Website plan.md': 'Launch steps for the website.',
  'CMS notes.md': 'Comparing content management systems.',
  'Inbox/Random thought.md': 'Something unrelated.',
  'Inbox/Mystery.md': 'No idea.',
  'Old/2026-01-05.md': 'Worked on the website.',
  'Templates/Daily.md': 'Template.',
  '1 Projects/Website relaunch/Launch.md': 'Existing launch note.',
  'Launch.md': 'A second launch note with the same name.',
};

/** Hand-made similarity: website notes are close to the project's notes. */
const NEIGHBORS: Record<string, Neighbor[]> = {
  'Website plan.md': [
    { path: 'CMS notes.md', score: 0.9 },
    { path: '1 Projects/Website relaunch/Sitemap.md', score: 0.8 },
    { path: '1 Projects/Website relaunch/Website relaunch.md', score: 0.75 },
    { path: '1 Projects/Website relaunch/Launch.md', score: 0.7 },
    { path: '2 Areas/Health/Check-up.md', score: 0.2 },
  ],
  'CMS notes.md': [
    { path: '1 Projects/Website relaunch/Sitemap.md', score: 0.7 },
    { path: '2 Areas/Health/Check-up.md', score: 0.6 },
  ],
  'Launch.md': [
    { path: '1 Projects/Website relaunch/Sitemap.md', score: 0.9 },
    { path: '1 Projects/Website relaunch/Launch.md', score: 0.9 },
    { path: '1 Projects/Website relaunch/Website relaunch.md', score: 0.8 },
  ],
};
const neighbors = (path: string, k: number) => (NEIGHBORS[path] ?? []).slice(0, k);

async function setup(llm?: LlmStage) {
  const harness = applyHarness(files, ['Old', 'Inbox', 'Templates', '1 Projects', '2 Areas']);
  const charter = presetCharter('para', 'en');
  const snapshot = await harness.vault.snapshot();
  const classification = await classifyNotes({ snapshot, charter, charterPath: 'Vault Charter.md', neighbors, llm });
  return { ...harness, charter, snapshot, classification };
}

describe('classifyNotes', () => {
  it('places notes by rules, current folder and similar placed notes, in that order', async () => {
    const { classification } = await setup();
    const at = (path: string) => classification.placements.get(path);
    expect(at('1 Projects/Website relaunch/Website relaunch.md')).toMatchObject({ destination: 'projects', subfolder: 'Website relaunch', source: 'rule', confidence: 1 });
    expect(at('2 Areas/Health/Check-up.md')).toMatchObject({ destination: 'areas', subfolder: 'Health', source: 'rule', signals: { inPlace: true } });
    expect(at('Old/2026-01-05.md')).toMatchObject({ destination: DAILY, source: 'rule' });
    // Three of its four placed neighbours are in the project: a clear majority, and their subfolder.
    expect(at('Website plan.md')).toMatchObject({ destination: 'projects', subfolder: 'Website relaunch', source: 'knn' });
    expect(at('Website plan.md')?.signals.knn).toMatchObject({
      supporters: 3,
      neighbors: ['1 Projects/Website relaunch/Sitemap.md', '1 Projects/Website relaunch/Website relaunch.md', '1 Projects/Website relaunch/Launch.md', '2 Areas/Health/Check-up.md'],
    });
    // A split vote is not enough.
    expect(at('CMS notes.md')).toMatchObject({ destination: null, source: null, signals: { knn: { destination: 'projects', supporters: 1 } } });
    expect(at('Inbox/Mystery.md')).toMatchObject({ destination: null, source: null });
    expect(classification.skipped.sort()).toEqual(['Templates/Daily.md', 'Vault Charter.md']);
  });

  it('asks the language model only about what is still open', async () => {
    const asked: string[] = [];
    const llm: LlmStage = async (notes, context) => {
      asked.push(...notes.map((n) => n.path));
      expect(context.targets.map((t) => t.id)).toEqual(['projects', 'areas', 'resources', 'archive']);
      return new Map([
        ['CMS notes.md', { destination: 'resources', subfolder: 'Web', confidence: 0.8, rationale: 'Reference material.' }],
        ['Inbox/Mystery.md', { destination: null, subfolder: null, confidence: 0.2, rationale: 'Too little to go on.' }],
      ]);
    };
    const { classification } = await setup(llm);
    expect(asked.sort()).toEqual(['CMS notes.md', 'Inbox/Mystery.md', 'Inbox/Random thought.md']);
    const cms = classification.placements.get('CMS notes.md');
    expect(cms).toMatchObject({ destination: 'resources', subfolder: 'Web', source: 'llm', signals: { llm: { confidence: 0.8 } } });
    // Calibrated: the self-report shrunk towards 0.5, minus the disagreeing kNN vote (share 0.7 / 1.3).
    expect(cms?.confidence).toBeCloseTo(0.5 + 0.3 * 0.6 - 0.2 * (0.7 / 1.3), 10);
    // The kNN evidence is kept next to the model's answer for calibration.
    expect(classification.placements.get('CMS notes.md')?.signals.knn?.destination).toBe('projects');
    expect(classification.placements.get('Inbox/Mystery.md')).toMatchObject({ destination: null, rationale: 'Too little to go on.' });
  });

  it('offers the vault root as a destination in properties mode', async () => {
    const harness = applyHarness({ 'Idea.md': 'An idea.', 'Misc/Other.md': 'Other.' }, ['Misc']);
    const charter = presetCharter('flat-categories', 'en');
    const classification = await classifyNotes({ snapshot: await harness.vault.snapshot(), charter, charterPath: null });
    expect(classification.placements.get('Idea.md')).toMatchObject({ destination: ROOT, source: 'rule' });
    expect(classification.targets.map((t) => t.id)).toContain(ROOT);
  });
});

describe('placementOperations', () => {
  it('moves misplaced notes, creates the folders they need, flags what it cannot do', async () => {
    const { classification, snapshot, charter } = await setup();
    const { operations, warnings } = placementOperations(classification, snapshot, charter);
    const summary = operations.map((op) => (op.kind === 'move' ? `move ${op.from} → ${op.to}` : op.kind === 'flag' ? `flag ${op.issue} ${op.path}` : `${op.kind} ${op.path}`));
    expect(summary).toEqual([
      'createFolder Daily',
      'move Old/2026-01-05.md → Daily/2026-01-05.md',
      'move Website plan.md → 1 Projects/Website relaunch/Website plan.md',
      'flag ambiguous CMS notes.md',
      'flag ambiguous Inbox/Mystery.md',
      'flag ambiguous Inbox/Random thought.md',
      // Similar notes place it in the project, where a note of that name already exists.
      'flag duplicate Launch.md',
    ]);
    expect(operations.find((op) => op.kind === 'move' && op.from === 'Website plan.md')).toMatchObject({ source: 'knn', precondition: { path: 'Website plan.md' } });
    expect(warnings).toEqual([expect.objectContaining({ code: 'ambiguous', message: expect.stringContaining('3 notes') as string })]);
  });

  it('flags a move onto an existing note instead of renaming', async () => {
    const { classification, snapshot, charter } = await setup();
    const { operations } = placementOperations(classification, snapshot, charter);
    expect(operations.find((op) => op.kind === 'flag' && op.path === 'Launch.md')).toMatchObject({ issue: 'duplicate', related: ['1 Projects/Website relaunch/Launch.md'] });
  });

  it('produces a plan that applies cleanly through the real executor', async () => {
    const { classification, snapshot, charter, vault, deps, storage, clock } = await setup();
    const { operations } = placementOperations(classification, snapshot, charter);
    const plan = createPlan({ id: 'cascade', createdAt: '2026-10-07T00:00:00.000Z', operations: operations.map((op) => ({ ...op, status: 'accepted' as const })) });
    const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'test', ignore: charter.ignore, allowedRoots: [...charterRoots(charter), 'Vault Charter.md'] });
    expect(outcome.kind === 'ran' && outcome.report).toMatchObject({ status: 'completed', applied: 3, failed: 0 });
    expect(await vault.exists('1 Projects/Website relaunch/Website plan.md')).toBe(true);
  });
});

describe('safeFolderName', () => {
  it('removes separators and reserved characters', () => {
    expect(safeFolderName(' Web/App: v2 [beta] ')).toBe('Web-App- v2 -beta-');
    expect(safeFolderName('...hidden')).toBe('hidden');
  });
});

describe('isKindDestination', () => {
  it('marks destinations defined by note kind, which similar content cannot decide', () => {
    const kinds = (id: Parameters<typeof presetCharter>[0]) => presetCharter(id, 'en').destinations.filter(isKindDestination).map((d) => d.id);
    expect(kinds('para')).toEqual([]);
    expect(kinds('johnny-decimal')).toEqual([]);
    expect(kinds('ace')).toEqual(['atlas-maps', 'atlas-sources', 'atlas-people', 'calendar-logs', 'calendar-meetings']);
    expect(kinds('zettelkasten')).toEqual(['fleeting', 'literature', 'permanent', 'hubs']);
  });
});
