import type { TfidfModel } from '../embeddings/tfidf';
import { chooseK, type Points } from './kmeans';
import { DEFAULT_PCA, denseOperator, type MatrixOperator, pca, sparseOperator } from './pca';

export interface Cluster {
  id: number;
  /** Member paths, closest to the centre first. */
  members: string[];
}

export interface Clustering {
  clusters: Cluster[];
  /** Path → cluster id. */
  assignments: Map<string, number>;
  /** Reduced, unit-length coordinates per path (for nearest-cluster search). */
  points: Points;
  paths: string[];
  /** Row-major `clusters × dims` centres in the reduced space. */
  centroids: Float64Array;
  silhouette: number;
}

export interface ClusterOptions {
  /** Dimensions after PCA (PLAN §7.4: 64). */
  dims: number;
  seed: number;
  maxK: number;
}

export const DEFAULT_CLUSTERING: ClusterOptions = { dims: 64, seed: 11, maxK: 40 };

/** Clusters notes by their embeddings (Tier 1): `matrix` holds one unit vector per path. */
export function clusterEmbeddings(paths: readonly string[], matrix: Float32Array, dims: number, options = DEFAULT_CLUSTERING): Clustering {
  return clusterOperator(paths, denseOperator(matrix, paths.length, dims), options);
}

/**
 * Clusters notes by their TF-IDF vectors (Tier 0): PCA over the sparse term matrix is latent
 * semantic analysis, which merges words that occur together, so notes cluster by subject even
 * when they share few exact words.
 */
export function clusterWords(model: TfidfModel, options = DEFAULT_CLUSTERING): Clustering {
  const vocabulary = new Map<string, number>();
  const rows = model.paths.map((path) =>
    [...(model.vector(path) ?? new Map<string, number>())].map(([term, weight]): [number, number] => {
      let index = vocabulary.get(term);
      if (index === undefined) vocabulary.set(term, (index = vocabulary.size));
      return [index, weight];
    }),
  );
  return clusterOperator(model.paths, sparseOperator(rows, vocabulary.size), options);
}

/**
 * PCA to `dims` dimensions, unit length (so Euclidean k-means follows cosine similarity), then
 * k-means++ with k chosen by silhouette (PLAN §7.4).
 */
function clusterOperator(paths: readonly string[], operator: MatrixOperator, options: ClusterOptions): Clustering {
  const count = paths.length;
  if (count < 3) {
    const points = { data: new Float64Array(0), count: 0, dims: 0 };
    return { clusters: count === 0 ? [] : [{ id: 0, members: [...paths] }], assignments: new Map(paths.map((p) => [p, 0])), points, paths: [...paths], centroids: new Float64Array(0), silhouette: 0 };
  }
  const reduced = pca(operator, { ...DEFAULT_PCA, components: options.dims, seed: options.seed });
  const dims = reduced.components;
  const data = reduced.scores;
  for (let i = 0; i < count; i++) {
    let norm = 0;
    for (let d = 0; d < dims; d++) norm += (data[i * dims + d] ?? 0) ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dims; d++) data[i * dims + d] = (data[i * dims + d] ?? 0) / norm;
  }
  const points = { data, count, dims };
  const result = chooseK(points, options.seed, options.maxK);

  const byCluster = new Map<number, { path: string; distance: number }[]>();
  paths.forEach((path, i) => {
    const c = result.assignments[i] ?? 0;
    let distance = 0;
    for (let d = 0; d < dims; d++) distance += ((data[i * dims + d] ?? 0) - (result.centroids[c * dims + d] ?? 0)) ** 2;
    const list = byCluster.get(c) ?? [];
    list.push({ path, distance });
    byCluster.set(c, list);
  });
  const clusters = [...byCluster.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, members]) => ({ id, members: members.sort((x, y) => x.distance - y.distance || (x.path < y.path ? -1 : 1)).map((m) => m.path) }));
  return {
    clusters,
    assignments: new Map(paths.map((path, i) => [path, result.assignments[i] ?? 0])),
    points,
    paths: [...paths],
    centroids: result.centroids,
    silhouette: result.silhouette,
  };
}
