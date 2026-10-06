import { describe, expect, it } from 'vitest';
import { prepareNote } from './prepare';
import { countTerms, type TermCounts, terms, TfidfModel } from './tfidf';
import { topK } from './top-k';

describe('terms', () => {
  it('folds diacritics, drops stopwords and short words, and truncates', () => {
    expect(terms('The gardening Garden and the gardens')).toEqual(['garden', 'garden', 'garden']);
    expect(terms('Zahrada, zahrady a zahradě')).toEqual(['zahrad', 'zahrad', 'zahrad']);
    expect(terms('Raised beds, a bed; class')).toEqual(['raised', 'bed', 'bed', 'class']);
    expect(terms('je to ale na 2024 x1')).toEqual([]);
  });
});

describe('countTerms', () => {
  it('weights the title and tags above body words', () => {
    const counts = countTerms(prepareNote('Soup with tomatoes.', 'Tomato soup'), ['cooking/soups']);
    expect(counts).toEqual({ tomato: 4, soup: 6, cookin: 2 });
  });
});

describe('TfidfModel', () => {
  const documents = new Map(
    Object.entries({
      'a.md': countTerms(prepareNote('Tomatoes need sun and compost in the raised bed.', 'Tomatoes')),
      'b.md': countTerms(prepareNote('Compost the raised bed before planting tomatoes.', 'Garden beds')),
      'c.md': countTerms(prepareNote('Intervals and long runs build marathon endurance.', 'Marathon')),
      'd.md': countTerms(prepareNote('Easy runs between intervals help recovery.', 'Running')),
      'e.md': countTerms(prepareNote('', 'Empty')),
    }),
  );
  const model = TfidfModel.build(documents);

  it('ranks notes about the same topic first and skips unrelated ones', () => {
    expect(model.similar('a.md', 3).map((n) => n.path)).toEqual(['b.md']);
    expect(model.similar('c.md', 3).map((n) => n.path)).toEqual(['d.md']);
  });

  it('returns cosine scores in (0, 1], excludes the note itself and requested paths', () => {
    const [first] = model.similar('a.md', 5);
    expect(first?.score).toBeGreaterThan(0);
    expect(first?.score).toBeLessThanOrEqual(1);
    expect(model.similar('a.md', 5, new Set(['b.md']))).toEqual([]);
    expect(model.similar('missing.md', 5)).toEqual([]);
    expect(model.similar('e.md', 5)).toEqual([]);
  });

  it('gives identical notes a similarity of 1', () => {
    const twin = TfidfModel.build(new Map<string, TermCounts>([['x.md', { word: 2, other: 1 }], ['y.md', { word: 2, other: 1 }], ['z.md', { third: 1 }]]));
    expect(twin.similar('x.md', 1)[0]?.score).toBeCloseTo(1, 10);
  });
});

describe('topK', () => {
  it('returns the best k, best first, with ties broken by index', () => {
    expect(topK([0.1, 0.9, 0.5, 0.9, 0.3], 3)).toEqual([
      { index: 1, score: 0.9 },
      { index: 3, score: 0.9 },
      { index: 2, score: 0.5 },
    ]);
    expect(topK([0.1, 0.9, 0.5], 2, (i) => i === 1)).toEqual([
      { index: 2, score: 0.5 },
      { index: 0, score: 0.1 },
    ]);
    expect(topK([1, Number.NaN], 5)).toEqual([{ index: 0, score: 1 }]);
    expect(topK([1, 2], 0)).toEqual([]);
  });

  it('matches a full sort on random input', () => {
    const scores = Array.from({ length: 500 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453));
    const expected = scores
      .map((score, index) => ({ index, score }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 25);
    expect(topK(scores, 25)).toEqual(expected);
  });
});

describe('TfidfModel.similarity', () => {
  it('matches the scores of similar()', () => {
    const model = TfidfModel.build(new Map<string, TermCounts>([['x.md', { garden: 2, soil: 1 }], ['y.md', { garden: 1, run: 1 }], ['z.md', { run: 2 }]]));
    expect(model.similarity('x.md', 'y.md')).toBeCloseTo(model.similar('x.md', 1)[0]?.score ?? 0, 12);
    expect(model.similarity('x.md', 'z.md')).toBe(0);
    expect(model.similarity('x.md', 'nope.md')).toBe(0);
  });
});
