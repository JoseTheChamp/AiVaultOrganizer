import { describe, expect, it } from 'vitest';
import { ApplyRunService } from '../apply/run';
import { UndoService } from '../apply/undo';
import { validatePlan } from '../apply/validate';
import { presetCharter } from '../charter/presets';
import type { Charter } from '../charter/schema';
import type { Neighbor } from '../embeddings/top-k';
import type { Operation } from '../model/operation';
import { applyHarness } from '../testing/apply-harness';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { DEFAULT_KNN } from './classify';
import { buildPlan, followMoves, type PlannerInput } from './plan';
import { charterRoots } from './charter-roots';

const charter: Charter = {
  ...presetCharter('para', 'en'),
  conventions: { ...presetCharter('para', 'en').conventions, tags: { style: 'lowercase-kebab', nested: true } },
};

const files = {
  'Vault Charter.md': '---\ncharter: true\n---\nCharter.',
  '1 Projects/Website relaunch/Website relaunch.md': '---\ntype: project\n---\nHub.',
  '1 Projects/Website relaunch/Sitemap.md': 'Sitemap. #Web_Dev',
  '1 Projects/Website relaunch/Launch.md': 'Launch.',
  'Website plan.md': '---\nType: Note\n---\nPlan for the website. #Web_Dev',
  'Dashboard.md': '```dataview\nLIST FROM "Inbox"\n```',
  'Inbox/Website copy.md': 'Copy for the website.',
};
const NEIGHBORS: Record<string, Neighbor[]> = {
  'Website plan.md': [
    { path: '1 Projects/Website relaunch/Sitemap.md', score: 0.9 },
    { path: '1 Projects/Website relaunch/Launch.md', score: 0.85 },
    { path: '1 Projects/Website relaunch/Website relaunch.md', score: 0.8 },
  ],
  'Inbox/Website copy.md': [
    { path: '1 Projects/Website relaunch/Sitemap.md', score: 0.9 },
    { path: '1 Projects/Website relaunch/Launch.md', score: 0.8 },
    { path: '1 Projects/Website relaunch/Website relaunch.md', score: 0.8 },
  ],
};

async function plan(model?: ScriptedChatProvider, options: Pick<PlannerInput, 'knn' | 'cardAges' | 'onProgress' | 'signal'> = {}) {
  const harness = applyHarness(files, ['Inbox', '1 Projects', '1 Projects/Website relaunch']);
  const snapshot = await harness.vault.snapshot();
  const result = await buildPlan({
    snapshot,
    charter,
    charterPath: 'Vault Charter.md',
    read: (path) => harness.vault.read(path),
    now: new Date(Date.UTC(2026, 9, 7)),
    neighbors: (path, k) => (NEIGHBORS[path] ?? []).slice(0, k),
    ...(model ? { model: { provider: model, name: 'scripted' } } : {}),
    ...options,
  });
  return { ...harness, snapshot, result };
}

describe('buildPlan', () => {
  it('combines placement, normalization and query checks into one valid plan', async () => {
    const { result, snapshot } = await plan();
    const ops = result.plan.operations;
    const describe = (op: Operation) => (op.kind === 'move' ? `move ${op.from} → ${op.to}` : op.kind === 'flag' ? `flag ${op.issue} ${op.path}` : `${op.kind} ${op.path}`);
    expect(ops.map(describe)).toEqual([
      'move Inbox/Website copy.md → 1 Projects/Website relaunch/Website copy.md',
      'move Website plan.md → 1 Projects/Website relaunch/Website plan.md',
      'flag ambiguous Dashboard.md',
      'renameProperty 1 Projects/Website relaunch/Website plan.md',
      // The charter spells the type value "note".
      'setProperty 1 Projects/Website relaunch/Website plan.md',
      'replaceTag 1 Projects/Website relaunch/Sitemap.md',
      'replaceTag 1 Projects/Website relaunch/Website plan.md',
      'flag query-breakage Dashboard.md',
    ]);
    // Edits of a moved note wait for its move, and keep the original path in their precondition.
    const rename = ops.find((op) => op.kind === 'renameProperty');
    const move = ops.find((op) => op.kind === 'move' && op.from === 'Website plan.md');
    expect(rename?.dependsOn).toEqual([move?.id]);
    expect(rename?.precondition?.path).toBe('Website plan.md');
    const report = validatePlan(result.plan, { snapshot, ignore: charter.ignore, allowedRoots: [...charterRoots(charter), 'Vault Charter.md'], include: () => true });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.summary).toMatchObject({ source: 'rules', summary: expect.stringContaining('moves 2 notes') as string });
    expect(result.plan.promptVersions).toEqual({});
  });

  it('applies completely through the real apply path, and undoes exactly', async () => {
    const { result, vault, deps, storage, clock } = await plan();
    const original = { contents: vault.contents(), folders: vault.folderPaths() };
    const accepted = { ...result.plan, operations: result.plan.operations.map((op) => ({ ...op, status: 'accepted' as const })) };
    const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(accepted, { pluginVersion: 'test', ignore: charter.ignore, allowedRoots: [...charterRoots(charter), 'Vault Charter.md'] });
    expect(outcome.kind === 'ran' && outcome.report).toMatchObject({ status: 'completed', failed: 0 });
    expect(await vault.read('1 Projects/Website relaunch/Website plan.md')).toBe('---\ntype: note\n---\nPlan for the website. #web-dev');
    await new UndoService(deps).undoLast();
    expect({ contents: vault.contents(), folders: vault.folderPaths() }).toEqual(original);
  });

  it('records the model and prompts when a language model takes part', async () => {
    const reply = JSON.stringify({ notes: [{ noteId: 'n1', destinationId: 'abstain', subfolder: null, confidence: 0.2, rationale: 'A dashboard.' }] });
    const { result } = await plan(new ScriptedChatProvider([reply, JSON.stringify({ summary: 'Two notes move.', highlights: [] })]));
    expect(result.plan.models).toEqual({ chat: 'scripted' });
    expect(result.plan.promptVersions).toEqual({ 'classify-notes': 2, 'subfolder-naming': 1, 'plan-summary': 1 });
    expect(result.model?.classification.calls).toBe(1);
    expect(result.summary).toEqual({ summary: 'Two notes move.', highlights: [], source: 'model' });
  });

  it('takes kNN thresholds that suit the similarity, and can leave note ages out', async () => {
    // Stricter than these neighbours: kNN decides nothing, so both loose notes go to the model.
    const reply = JSON.stringify({ notes: [] });
    const model = new ScriptedChatProvider([reply, reply, JSON.stringify({ summary: 'Nothing moves.', highlights: [] })]);
    const { result } = await plan(model, { knn: { ...DEFAULT_KNN, minSimilarity: 0.95 } });
    expect(result.plan.operations.filter((op) => op.kind === 'move')).toEqual([]);
    expect(model.requests[0]?.messages.at(-1)?.content).toContain('Website plan');

    const withAges = new ScriptedChatProvider([reply, reply, '{}', '{}']);
    await plan(withAges, { knn: { ...DEFAULT_KNN, minSimilarity: 0.95 } });
    const withoutAges = new ScriptedChatProvider([reply, reply, '{}', '{}']);
    await plan(withoutAges, { knn: { ...DEFAULT_KNN, minSimilarity: 0.95 }, cardAges: false });
    expect(JSON.stringify(withAges.requests[0])).toContain('Last changed');
    expect(JSON.stringify(withoutAges.requests[0])).not.toContain('Last changed');
  });
});

describe('buildPlan progress and stopping', () => {
  it('reports its steps and counts the notes the model answered', async () => {
    const steps: string[] = [];
    const reply = JSON.stringify({ notes: [{ noteId: 'n1', rationale: 'A dashboard.', destinationId: 'abstain', subfolder: null, confidence: 0.2 }] });
    await plan(new ScriptedChatProvider([reply, JSON.stringify({ summary: 'Two notes move.', highlights: [] })]), {
      onProgress: ({ step, done, total }) => steps.push(done === undefined ? step : `${step} ${done}/${total ?? 0}`),
    });
    expect(steps).toEqual(['reading', 'classifying 0/1', 'classifying 1/1', 'naming', 'checking', 'summarizing']);
  });

  it('stops asking the model when told to, and still builds the plan', async () => {
    const model = new ScriptedChatProvider([]);
    const { result } = await plan(model, { signal: { aborted: true } });
    expect(model.requests).toEqual([]);
    expect(result.summary.source).toBe('rules');
    expect(result.plan.operations.flatMap((op) => (op.kind === 'flag' && op.issue === 'ambiguous' ? [op.path] : []))).toContain('Dashboard.md');
  });
});

describe('buildPlan without neighbours or a model', () => {
  const now = new Date(Date.UTC(2026, 9, 7));
  const rulesOnly = async (charter: Charter, files: Record<string, string>, folders: string[] = [], createDestinationFolders = false) => {
    const { vault } = applyHarness(files, folders);
    return (await buildPlan({ snapshot: await vault.snapshot(), charter, charterPath: null, read: (path) => vault.read(path), now, createDestinationFolders })).plan;
  };

  it('is empty for a vault that already follows its charter', async () => {
    const plan = await rulesOnly(presetCharter('para', 'en'), { '1 Projects/A/A.md': '---\ntype: project\n---\n', 'Daily/2026-10-01.md': '' }, ['0 Inbox', '2 Areas', '3 Resources', '4 Archive']);
    expect(plan.operations).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("creates the charter's missing folders when asked, leaving their parents to the apply step", async () => {
    const charter = presetCharter('johnny-decimal', 'en');
    // A note the rules file under 11 Finance, so its folder is also needed by a move.
    const plan = await rulesOnly(charter, { '11.01 Budget.md': '' }, [], true);
    expect(plan.operations.find((op) => op.kind === 'move')).toMatchObject({ to: '10-19 Life admin/11 Finance/11.01 Budget.md' });
    const folders = plan.operations.map((op) => (op.kind === 'createFolder' ? op.path : null));
    expect(folders).toContain('10-19 Life admin/11 Finance');
    expect(folders).toContain('00-09 System/02 Daily');
    // An area on its own is no destination: proposing it made the review show its own plan as invalid.
    expect(folders).not.toContain('10-19 Life admin');
    const report = validatePlan(plan, { snapshot: await applyHarness({ '11.01 Budget.md': '' }).vault.snapshot(), ignore: charter.ignore, allowedRoots: charterRoots(charter), include: () => true });
    expect(report.issues).toEqual([]);
  });

  it('adds the category link of a category destination, after the move when there is one', async () => {
    const flat = presetCharter('flat-categories', 'en');
    const recipes = { id: 'recipes', category: '[[Recipes]]', description: '', layout: 'flat' as const, priority: 0, match: [{ property: 'type', equals: 'recipe' }], examples: [] };
    const plan = await rulesOnly({ ...flat, destinations: [...flat.destinations, recipes] }, { 'Soup.md': '---\ntype: recipe\ncategories: "[[Food]]"\n---\n' });
    // (The preset's category notes are planned too; this test is about the note's own property.)
    expect(plan.operations.filter((op) => op.kind === 'setProperty')).toMatchObject([{ path: 'Soup.md', key: 'categories', value: ['[[Food]]', '[[Recipes]]'], source: 'rule' }]);

    const filed = { ...recipes, path: 'Recipes' };
    const moved = await rulesOnly({ ...flat, mode: 'hybrid', destinations: [filed] }, { 'Soup.md': '---\ntype: recipe\n---\n' });
    const move = moved.operations.find((op) => op.kind === 'move');
    expect(moved.operations.find((op) => op.kind === 'setProperty')).toMatchObject({ path: 'Recipes/Soup.md', value: ['[[Recipes]]'], dependsOn: [move?.id], precondition: { path: 'Soup.md' } });
  });
});

describe('followMoves', () => {
  it('leaves operations on notes that do not move untouched', () => {
    const op = { id: 'x', kind: 'setProperty', path: 'a.md', key: 'k', value: 1, rationale: '', confidence: 1, source: 'rule', status: 'pending' } as const;
    expect(followMoves([op], [])).toEqual([op]);
  });
});
