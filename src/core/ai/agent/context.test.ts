import { describe, expect, it } from 'vitest';
import { analyzeVault } from '../../analysis/analyze';
import type { Clustering } from '../../analysis/clusters';
import { InMemoryVault } from '../../testing/in-memory-vault';
import { agentContext, estimateAgentRun } from './context';

const files: Record<string, string> = {
  'Bread.md': 'Sourdough bread needs a ripe starter and a long cold proof.',
  'Pizza.md': 'Pizza dough with sourdough starter, a long cold proof and a hot oven.',
  'Diary.md': '---\nai-vault-organizer: private\n---\nSecret sourdough worries.',
  'Run.md': 'Interval training builds speed for the half marathon.',
  'Race.md': 'Half marathon race week: taper, sleep and an easy run.',
};

/** Two hand-made groups stand in for word clustering, which has its own tests. */
const clustering = {
  clusters: [
    { id: 0, members: ['Run.md', 'Race.md'] },
    { id: 1, members: ['Bread.md', 'Diary.md', 'Pizza.md'] },
  ],
} as unknown as Clustering;

describe('agentContext', () => {
  it('describes the largest groups with keywords and cards, and keeps private notes out', async () => {
    const vault = InMemoryVault.from(files);
    const snapshot = await vault.snapshot();
    const { context, withheld } = await agentContext({
      analysis: analyzeVault(snapshot, { now: 0 }),
      snapshot,
      clustering,
      read: (path) => vault.read(path),
      language: 'en',
      now: Date.UTC(2026, 9, 7),
    });
    expect(withheld).toBe(1);
    expect(context.clusters.map((cluster) => [cluster.id, cluster.size])).toEqual([
      [1, 3],
      [0, 2],
    ]);
    const baking = context.clusters[0];
    expect(baking?.samples.map((card) => card.title)).toEqual(['Bread', 'Pizza']);
    expect(baking?.keywords).toContain('sourdough');
    expect(baking?.keywords).not.toContain('worries');
    expect(baking?.label).toBe(baking?.keywords.slice(0, 3).join(', '));
    expect(JSON.stringify(context)).not.toContain('Secret');
  });

  it('estimates the run up to the agent budget', async () => {
    const vault = InMemoryVault.from(files);
    const snapshot = await vault.snapshot();
    const { context, withheld } = await agentContext({ analysis: analyzeVault(snapshot, { now: 0 }), snapshot, clustering, read: (path) => vault.read(path), language: 'en', now: 0 });
    const estimate = estimateAgentRun(context, withheld, { maxSteps: 8, maxTokens: 40_000 });
    expect(estimate).toMatchObject({ notes: 4, withheld: 1, calls: { min: 2, max: 8 } });
    expect(estimate.inputTokens.max + estimate.outputTokens.max).toBe(40_000);
    expect(estimate.inputTokens.min).toBeGreaterThan(500);
  });
});
