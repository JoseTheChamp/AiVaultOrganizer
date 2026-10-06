import { describe, expect, it } from 'vitest';
import { verifyLinksV1 } from '../ai/prompts/verify-links.v1';
import { testCard } from '../testing/cards';
import { ScriptedChatProvider } from '../testing/fake-chat';
import type { LinkCandidate } from './link-candidates';
import { verifyLinks } from './link-verify';

const card = (path: string, excerpt = `About ${path}.`) => testCard(path, excerpt);
const candidate = (source: string, target: string, score = 0.8): LinkCandidate => ({ source, target, score, similarity: score, sharedTags: 0, sharedNeighbors: 0 });
const answer = (...pairs: [string, boolean, number, string][]) =>
  JSON.stringify({ pairs: pairs.map(([pairId, relevant, strength, reason]) => ({ pairId, relevant, strength, reason })) });

describe('verify-links v1', () => {
  const input = { language: 'en' as const, pairs: [{ id: 'p1', a: card('Tomatoes.md', 'Seedlings need light.'), b: card('Compost.md', 'Turn it every two weeks.') }] };

  it('renders a stable prompt', () => {
    expect(verifyLinksV1.build(input)).toMatchSnapshot();
  });

  it('accepts each shown pair exactly once with a strength from 1 to 3', () => {
    const schema = verifyLinksV1.schema(input);
    expect(schema.safeParse(JSON.parse(answer(['p1', true, 2, 'Both about the garden.']))).success).toBe(true);
    expect(schema.safeParse(JSON.parse(answer(['p1', true, 4, 'Too strong.']))).success).toBe(false);
    expect(schema.safeParse(JSON.parse(answer(['p2', true, 2, 'Unknown pair.']))).success).toBe(false);
    expect(schema.safeParse({ pairs: [] }).success).toBe(false);
  });
});

describe('verifyLinks', () => {
  const cards = new Map(['a.md', 'b.md', 'c.md', 'd.md'].map((path) => [path, card(path)]));
  const candidates = new Map([
    ['a.md', [candidate('a.md', 'b.md'), candidate('a.md', 'c.md'), candidate('a.md', 'd.md'), candidate('a.md', 'x.md')]],
    ['b.md', [candidate('b.md', 'a.md')]],
  ]);

  it('asks once per unordered pair, keeps relevant ones and rejects the rest', async () => {
    const provider = new ScriptedChatProvider([answer(['p1', true, 3, 'Same project.'], ['p2', false, 1, 'Only a common word.'])]);
    const report = await verifyLinks(provider, 'en', candidates, cards, { perNote: 2, batchSize: 8 });
    expect(report.pairs).toBe(2);
    expect(report.kept.map((c) => [c.source, c.target, c.verdict?.reason])).toEqual([
      ['a.md', 'b.md', 'Same project.'],
      ['b.md', 'a.md', 'Same project.'],
    ]);
    expect(report.rejected.map((c) => c.target)).toEqual(['c.md']);
    expect(report).toMatchObject({ calls: 1, failures: 0 });
    expect(provider.requests[0]?.prompt).toEqual({ id: 'verify-links', version: 1 });
  });

  it('never sends a pair with a note that has no card, and keeps a failed batch unverified', async () => {
    const provider = new ScriptedChatProvider(['nope', 'still nope']);
    const report = await verifyLinks(provider, 'en', new Map([['a.md', [candidate('a.md', 'x.md'), candidate('a.md', 'b.md')]]]), cards);
    expect(report.pairs).toBe(1);
    expect(report.kept).toEqual([{ ...candidate('a.md', 'b.md'), verdict: null }]);
    expect(report).toMatchObject({ calls: 2, failures: 1 });
    expect(JSON.stringify(provider.requests)).not.toContain('x.md');
  });
});
