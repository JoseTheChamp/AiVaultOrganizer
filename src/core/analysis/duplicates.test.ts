import { describe, expect, it } from 'vitest';
import { findDuplicates, titleSimilarity } from './duplicates';
import { estimateJaccard, jaccard, lshCandidates, MinHasher, shingles, words } from './minhash';

const sentence = (topic: string, i: number): string => `${topic} sentence number ${i} explains one more detail about ${topic} in plain words.`;
const text = (topic: string, from: number, to: number): string =>
  Array.from({ length: to - from }, (_, i) => sentence(topic, from + i)).join(' ');

describe('shingles and Jaccard', () => {
  it('folds case and diacritics and makes 5-word shingles', () => {
    expect(words('Žluťoučký KŮŇ, 2× rychle!')).toEqual(['zlutoucky', 'kun', '2', 'rychle']);
    expect([...shingles('one two three four five six')]).toEqual(['one two three four five', 'two three four five six']);
    expect([...shingles('just three words')]).toEqual(['just three words']);
    expect(shingles('').size).toBe(0);
  });

  it('estimates Jaccard from signatures within a few points', () => {
    const a = shingles(text('garden', 0, 20));
    const b = shingles(text('garden', 10, 30));
    const hasher = new MinHasher(256);
    expect(Math.abs(estimateJaccard(hasher.signature(a), hasher.signature(b)) - jaccard(a, b))).toBeLessThan(0.08);
    expect(hasher.signature(a)).toEqual(new MinHasher(256).signature(a));
  });

  it('turns similar notes into LSH candidates and leaves different ones out', () => {
    const hasher = new MinHasher();
    const signatures = new Map([
      ['a.md', hasher.signature(shingles(text('garden', 0, 10)))],
      ['b.md', hasher.signature(shingles(text('garden', 1, 11)))],
      ['c.md', hasher.signature(shingles('Intervals on Tuesday build speed. The long run grows by a kilometre each week until the race.'))],
    ]);
    expect(lshCandidates(signatures)).toEqual([['a.md', 'b.md']]);
  });
});

describe('titleSimilarity', () => {
  it('scores copies of a title high and different titles low', () => {
    expect(titleSimilarity('Launch checklist', 'Launch checklist v2')).toBeCloseTo(0.8, 10);
    expect(titleSimilarity('Rozpočet na stěhování', 'Rozpocet na stehovani (kopie)')).toBeCloseTo(6 / 7, 10);
    expect(titleSimilarity('Gradient descent', 'Back pain exercises')).toBe(0);
    expect(titleSimilarity('', 'x')).toBe(0);
  });
});

describe('findDuplicates', () => {
  const notes = [
    { path: 'Plan.md', title: 'Plan', text: text('garden', 0, 6) },
    { path: 'Inbox/Plan (copy).md', title: 'Plan (copy)', text: text('garden', 1, 6) },
    { path: 'Beds.md', title: 'Raised beds', text: text('garden', 2, 7) },
    { path: 'Same.md', title: 'Identical body', text: text('marathon', 0, 6) },
    { path: 'Other.md', title: 'Different title', text: text('marathon', 0, 6) },
    { path: '2026-01-05.md', title: '2026-01-05', text: 'Worked on the garden. Slept badly.' },
    { path: '2026-01-06.md', title: '2026-01-06', text: 'Worked on the garden. Slept badly.' },
  ];

  it('needs matching titles unless the content is nearly identical, and skips daily notes', () => {
    const pairs = findDuplicates(notes);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      ['Other.md', 'Same.md'],
      ['Inbox/Plan (copy).md', 'Plan.md'],
    ]);
    // Raised beds shares sentences with Plan but has its own title: same topic, not a copy.
    const copy = pairs.find((p) => p.b === 'Plan.md');
    expect(copy?.title).toBeCloseTo(2 / 3, 10);
    expect(copy?.confidence).toBeGreaterThan(0.5);
  });

  it('adds embedding neighbours as candidates and records their similarity', () => {
    const shortCopy = [
      { path: 'Budget.md', title: 'Budget', text: 'Rent, food and school.' },
      { path: 'Budget v2.md', title: 'Budget v2', text: 'School, rent and food costs.' },
    ];
    expect(findDuplicates(shortCopy)).toEqual([]);
    const neighbors = (path: string) => [{ path: path === 'Budget.md' ? 'Budget v2.md' : 'Budget.md', score: 0.9 }];
    expect(findDuplicates(shortCopy, neighbors)).toEqual([expect.objectContaining({ a: 'Budget v2.md', b: 'Budget.md', cosine: 0.9 })]);
  });
});
