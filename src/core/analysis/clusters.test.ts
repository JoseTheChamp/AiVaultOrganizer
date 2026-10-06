import { describe, expect, it } from 'vitest';
import { prepareNote } from '../embeddings/prepare';
import { countTerms, TfidfModel } from '../embeddings/tfidf';
import { gaussian, mulberry32 } from '../model/random';
import { clusterEmbeddings, clusterWords } from './clusters';
import { chooseK, kmeans, type Points, silhouette } from './kmeans';
import { denseOperator, pca, sparseOperator, symmetricEigen } from './pca';

/** `perCluster` noisy points around each of the given centres. */
function blobs(centres: number[][], perCluster: number, spread: number, seed = 3): Points {
  const normal = gaussian(mulberry32(seed));
  const dims = centres[0]?.length ?? 0;
  const data = new Float64Array(centres.length * perCluster * dims);
  centres.forEach((centre, c) => {
    for (let p = 0; p < perCluster; p++) {
      for (let d = 0; d < dims; d++) data[(c * perCluster + p) * dims + d] = (centre[d] ?? 0) + normal() * spread;
    }
  });
  return { data, count: centres.length * perCluster, dims };
}

describe('symmetricEigen', () => {
  it('diagonalizes a symmetric matrix', () => {
    const { values, vectors } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    expect([...values].sort()).toEqual([expect.closeTo(1, 10), expect.closeTo(3, 10)]);
    const big = values.indexOf(Math.max(...values));
    expect(Math.abs(vectors[0]?.[big] ?? 0)).toBeCloseTo(Math.SQRT1_2, 10);
  });
});

describe('pca', () => {
  it('finds the direction the data varies along, for dense and sparse matrices alike', () => {
    // Points along (1, 2, 0) with a little noise in z.
    const rows = 50;
    const dense = new Float32Array(rows * 3);
    const sparse: [number, number][][] = [];
    for (let r = 0; r < rows; r++) {
      const t = r / 10 - 2.5;
      const z = r % 2 === 0 ? 0.01 : -0.01;
      dense.set([t, 2 * t, z], r * 3);
      sparse.push([[0, t], [1, 2 * t], [2, z]]);
    }
    for (const operator of [denseOperator(dense, rows, 3), sparseOperator(sparse, 3)]) {
      const result = pca(operator, { components: 2, oversample: 1, iterations: 2, seed: 1 });
      expect(result.components).toBe(2);
      expect((result.variances[0] ?? 0) / (result.variances[1] ?? 1)).toBeGreaterThan(1000);
      // The first score is the signed distance along the centred line: t − mean(t) = −2.45, times √5.
      expect(Math.abs(result.scores[0] ?? 0)).toBeCloseTo(2.45 * Math.sqrt(5), 3);
    }
  });

  it('is deterministic for a seed', () => {
    const points = blobs([[0, 0, 0, 0], [5, 5, 0, 0]], 10, 0.5);
    const matrix = Float32Array.from(points.data);
    const run = () => pca(denseOperator(matrix, points.count, points.dims), { components: 2, oversample: 2, iterations: 2, seed: 9 }).scores;
    expect(run()).toEqual(run());
  });
});

describe('kmeans', () => {
  const points = blobs([[0, 0], [10, 0], [0, 10]], 20, 0.5);

  it('separates well-separated blobs and is deterministic', () => {
    const result = kmeans(points, 3, 1);
    for (let c = 0; c < 3; c++) {
      const labels = new Set(Array.from(result.assignments.subarray(c * 20, (c + 1) * 20)));
      expect(labels.size).toBe(1);
    }
    expect(new Set(result.assignments).size).toBe(3);
    expect(kmeans(points, 3, 1)).toEqual(result);
    expect(silhouette(points, result)).toBeGreaterThan(0.8);
  });

  it('never leaves a cluster empty, even with more clusters than distinct points', () => {
    const twins = { data: Float64Array.from([0, 0, 0, 0, 1, 1, 1, 1]), count: 4, dims: 2 };
    expect(new Set(kmeans(twins, 3, 1).assignments).size).toBe(3);
  });

  it('chooses the number of clusters by silhouette', () => {
    const five = blobs([[0, 0], [10, 0], [0, 10], [10, 10], [5, 20]], 12, 0.4);
    const result = chooseK(five, 1);
    expect(result.k).toBe(5);
    expect(result.tried.length).toBeGreaterThan(3);
  });
});

describe('clusterEmbeddings and clusterWords', () => {
  it('cluster notes by subject and list members closest to the centre first', () => {
    const points = blobs([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]], 8, 0.05);
    const matrix = Float32Array.from(points.data);
    const paths = Array.from({ length: 24 }, (_, i) => `${['garden', 'running', 'money'][Math.floor(i / 8)]}-${i}.md`);
    const clustering = clusterEmbeddings(paths, matrix, 4);
    expect(clustering.clusters).toHaveLength(3);
    for (const cluster of clustering.clusters) expect(new Set(cluster.members.map((p) => p.split('-')[0])).size).toBe(1);
    expect(clustering.assignments.size).toBe(24);
  });

  it('works from word statistics alone', () => {
    const topics: Record<string, string[]> = {
      garden: ['Tomatoes need compost and water in the raised bed.', 'Prune the apple tree before the buds open.', 'Mulch keeps the soil moist and stops weeds.'],
      running: ['Intervals on Tuesday build speed for the race.', 'The long run grows by a kilometre each week.', 'Easy runs help recovery between intervals.'],
      money: ['The budget splits income into needs and savings.', 'Index funds keep fees low and spread risk.', 'An emergency fund covers six months of expenses.'],
    };
    const documents = new Map(
      Object.entries(topics).flatMap(([topic, sentences]) =>
        Array.from({ length: 8 }, (_, i) => [`${topic}-${i}.md`, countTerms(prepareNote(`${sentences[i % 3]} ${sentences[(i + 1) % 3]}`, `${topic} note ${i}`))] as const),
      ),
    );
    const clustering = clusterWords(TfidfModel.build(documents));
    for (const cluster of clustering.clusters) expect(new Set(cluster.members.map((p) => p.split('-')[0])).size).toBe(1);
  });

  it('puts tiny vaults in one cluster', () => {
    expect(clusterEmbeddings(['a.md', 'b.md'], new Float32Array(8), 4).clusters).toEqual([{ id: 0, members: ['a.md', 'b.md'] }]);
  });
});
