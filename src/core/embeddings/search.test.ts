import { describe, expect, it } from 'vitest';
import { createSearchHandler, type DenseIndex, DenseSearch } from './search';

function unit(...values: number[]): number[] {
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}

const index: DenseIndex = {
  paths: ['a.md', 'b.md', 'c.md', 'd.md'],
  dims: 3,
  matrix: Float32Array.from([...unit(1, 0, 0), ...unit(0.9, 0.1, 0), ...unit(0, 1, 0), ...unit(0.5, 0.5, 0)]),
};

describe('DenseSearch', () => {
  const search = new DenseSearch(index);

  it('ranks by cosine similarity and excludes the note itself', () => {
    const neighbors = search.similar('a.md', 3);
    expect(neighbors.map((n) => n.path)).toEqual(['b.md', 'd.md', 'c.md']);
    expect(neighbors[0]?.score).toBeCloseTo(unit(0.9, 0.1, 0)[0] ?? 0, 5);
    expect(neighbors[2]?.score).toBeCloseTo(0, 5);
  });

  it('honours exclusions, k and unknown paths', () => {
    expect(search.similar('a.md', 1, new Set(['b.md'])).map((n) => n.path)).toEqual(['d.md']);
    expect(search.similar('missing.md', 3)).toEqual([]);
    expect(search.nearest(Float32Array.from(unit(0, 1, 0)), 1)[0]?.path).toBe('c.md');
    expect(() => search.nearest(new Float32Array(2), 1)).toThrow(/3-dimensional/);
  });

  it('rejects a matrix that does not match its paths', () => {
    expect(() => new DenseSearch({ paths: ['a.md'], dims: 3, matrix: new Float32Array(4) })).toThrow();
  });

  it('searches thousands of high-dimensional notes quickly', () => {
    const n = 5000;
    const dims = 1024;
    const matrix = new Float32Array(n * dims);
    let seed = 1;
    for (let i = 0; i < matrix.length; i++) matrix[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const large = new DenseSearch({ paths: Array.from({ length: n }, (_, i) => `n${i}.md`), dims, matrix });
    const started = performance.now();
    expect(large.similar('n0.md', 10)).toHaveLength(10);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('createSearchHandler', () => {
  it('loads an index, answers searches and reports errors as messages', () => {
    const handle = createSearchHandler();
    expect(handle({ id: 1, type: 'similar', path: 'a.md', k: 1, exclude: [] })).toEqual({ id: 1, type: 'error', message: 'No index is loaded.' });
    expect(handle({ id: 2, type: 'load', paths: [...index.paths], dims: 3, matrix: index.matrix })).toEqual({ id: 2, type: 'loaded', size: 4 });
    expect(handle({ id: 3, type: 'similar', path: 'a.md', k: 1, exclude: [] })).toMatchObject({ id: 3, type: 'result', neighbors: [{ path: 'b.md' }] });
    expect(handle({ id: 4, type: 'load', paths: ['x.md'], dims: 3, matrix: new Float32Array(1) })).toMatchObject({ id: 4, type: 'error' });
  });
});
