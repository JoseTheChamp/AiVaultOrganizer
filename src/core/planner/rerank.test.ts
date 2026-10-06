import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets';
import type { Neighbor } from '../embeddings/top-k';
import { createOperation, type Operation } from '../model/operation';
import { createPlan } from '../model/plan';
import { InMemoryVault } from '../testing/in-memory-vault';
import { DEFAULT_KNN } from './classify';
import { rerankFromDecisions } from './rerank';

const charter = presetCharter('para', 'en');
const HUB = '1 Projects/Website/Website.md';
const files = {
  [HUB]: '---\ntype: project\n---\nRelaunch.',
  'Sitemap.md': 'Pages of the new site.',
  'Copy.md': 'Texts for the new site.',
  'Launch.md': 'Launch checklist for the site.',
  'Banner.md': 'Banner for the site.',
};
// Every loose note is close to the hub and to each other.
const around = (path: string): Neighbor[] =>
  [HUB, 'Sitemap.md', 'Copy.md', 'Launch.md', 'Banner.md'].filter((other) => other !== path).map((other, i) => ({ path: other, score: 0.9 - i * 0.01 }));

const move = (from: string, to: string, status: Operation['status']) => createOperation({ kind: 'move', from, to }, { source: 'llm', confidence: 0.6, rationale: 'Suggested by the language model.', status });

async function rerank(operations: Operation[]) {
  const snapshot = await InMemoryVault.from(files).snapshot();
  const plan = createPlan({ id: 'p', createdAt: '2026-10-07T00:00:00.000Z', operations });
  return rerankFromDecisions({ plan, snapshot, charter, charterPath: null, neighbors: (path, k) => around(path).slice(0, k), knn: DEFAULT_KNN });
}

describe('rerankFromDecisions', () => {
  it('learns from accepted moves: agreeing moves gain, contradicting ones lose, flagged notes get a place', async () => {
    const result = await rerank([
      move('Sitemap.md', '1 Projects/Website/Sitemap.md', 'accepted'),
      move('Copy.md', '1 Projects/Website/Copy.md', 'accepted'),
      move('Launch.md', '1 Projects/Website/Launch.md', 'pending'),
      move('Banner.md', '3 Resources/Banner.md', 'pending'),
    ]);
    const [, , agreeing, contradicting] = result.plan.operations;
    expect(agreeing?.confidence).toBeGreaterThan(0.9);
    expect(agreeing?.rationale).toContain('Your decisions agree: 3 similar notes are in 1 Projects.');
    expect(contradicting?.confidence).toBeLessThan(0.1);
    expect(contradicting?.rationale).toContain('similar notes you placed are in 1 Projects');
    expect(result.rescored).toBe(2);
  });

  it('proposes a place for an ambiguous note once enough similar notes are placed', async () => {
    const result = await rerank([
      move('Sitemap.md', '1 Projects/Website/Sitemap.md', 'accepted'),
      move('Copy.md', '1 Projects/Website/Copy.md', 'accepted'),
      createOperation({ kind: 'flag', path: 'Banner.md', issue: 'ambiguous' }, { confidence: 0 }),
    ]);
    expect(result.placed).toBe(1);
    expect(result.plan.operations.at(-1)).toMatchObject({ kind: 'move', from: 'Banner.md', to: '1 Projects/Website/Banner.md', source: 'knn', status: 'pending' });
  });

  it('never proposes a destination the reviewer rejected for that note, and leaves decided rows alone', async () => {
    const result = await rerank([
      move('Sitemap.md', '1 Projects/Website/Sitemap.md', 'accepted'),
      move('Copy.md', '1 Projects/Website/Copy.md', 'accepted'),
      move('Banner.md', '1 Projects/Website/Banner.md', 'rejected'),
      createOperation({ kind: 'flag', path: 'Banner.md', issue: 'ambiguous' }, { confidence: 0 }),
    ]);
    expect(result.placed).toBe(0);
    expect(result.plan.operations.map((op) => op.kind)).toEqual(['move', 'move', 'move', 'flag']);
    expect(result.plan.operations[2]?.confidence).toBe(0.6);
  });
});
