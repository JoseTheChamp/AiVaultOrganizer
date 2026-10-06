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
import { charterRoots } from './rule-plan';

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

async function plan(model?: ScriptedChatProvider, options: Pick<PlannerInput, 'knn' | 'cardAges'> = {}) {
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
    expect(result.plan.promptVersions).toEqual({ 'classify-notes': 1, 'subfolder-naming': 1, 'plan-summary': 1 });
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

describe('followMoves', () => {
  it('leaves operations on notes that do not move untouched', () => {
    const op = { id: 'x', kind: 'setProperty', path: 'a.md', key: 'k', value: 1, rationale: '', confidence: 1, source: 'rule', status: 'pending' } as const;
    expect(followMoves([op], [])).toEqual([op]);
  });
});
