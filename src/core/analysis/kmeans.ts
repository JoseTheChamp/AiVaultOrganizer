import { mulberry32, type Random } from '../model/random';

/** Points as one row-major matrix: `count × dims`. */
export interface Points {
  data: Float64Array;
  count: number;
  dims: number;
}

export interface KMeansResult {
  k: number;
  /** Cluster index per point. */
  assignments: Int32Array;
  /** Row-major `k × dims`. */
  centroids: Float64Array;
  /** Sum of squared distances to the assigned centroid. */
  inertia: number;
}

function distance2(points: Points, i: number, centroids: Float64Array, c: number): number {
  const { data, dims } = points;
  let sum = 0;
  for (let d = 0; d < dims; d++) {
    const diff = (data[i * dims + d] ?? 0) - (centroids[c * dims + d] ?? 0);
    sum += diff * diff;
  }
  return sum;
}

/** k-means++ seeding: each new centre is drawn with probability proportional to squared distance. */
function seedCentroids(points: Points, k: number, random: Random): Float64Array {
  const { data, count, dims } = points;
  const centroids = new Float64Array(k * dims);
  const first = Math.floor(random() * count);
  centroids.set(data.subarray(first * dims, (first + 1) * dims), 0);
  const nearest = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < count; i++) {
      nearest[i] = Math.min(nearest[i] ?? 0, distance2(points, i, centroids, c - 1));
      total += nearest[i] ?? 0;
    }
    let target = random() * total;
    let chosen = count - 1;
    for (let i = 0; i < count; i++) {
      target -= nearest[i] ?? 0;
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.set(data.subarray(chosen * dims, (chosen + 1) * dims), c * dims);
  }
  return centroids;
}

/**
 * Lloyd's k-means with k-means++ seeding, deterministic for a seed. An emptied cluster is
 * re-seeded with the point farthest from its centre, so every cluster ends up with members.
 */
export function kmeans(points: Points, k: number, seed = 1, maxIterations = 100): KMeansResult {
  const { data, count, dims } = points;
  const clusters = Math.max(1, Math.min(k, count));
  const random = mulberry32(seed);
  const centroids = seedCentroids(points, clusters, random);
  const assignments = new Int32Array(count).fill(-1);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < clusters; c++) {
        const d = distance2(points, i, centroids, c);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    const sums = new Float64Array(clusters * dims);
    const sizes = new Int32Array(clusters);
    for (let i = 0; i < count; i++) {
      const c = assignments[i] ?? 0;
      sizes[c] = (sizes[c] ?? 0) + 1;
      for (let d = 0; d < dims; d++) sums[c * dims + d] = (sums[c * dims + d] ?? 0) + (data[i * dims + d] ?? 0);
    }
    for (let c = 0; c < clusters; c++) {
      const size = sizes[c] ?? 0;
      if (size > 0) {
        for (let d = 0; d < dims; d++) centroids[c * dims + d] = (sums[c * dims + d] ?? 0) / size;
        continue;
      }
      let far = 0;
      let farDistance = -1;
      for (let i = 0; i < count; i++) {
        const d = distance2(points, i, centroids, assignments[i] ?? 0);
        if (d > farDistance) {
          farDistance = d;
          far = i;
        }
      }
      centroids.set(data.subarray(far * dims, (far + 1) * dims), c * dims);
      assignments[far] = c;
      changed = true;
    }
    if (!changed) break;
  }
  let inertia = 0;
  for (let i = 0; i < count; i++) inertia += distance2(points, i, centroids, assignments[i] ?? 0);
  return { k: clusters, assignments, centroids, inertia };
}

/** Above this many points the exact silhouette (O(n²)) gives way to the simplified one (O(n·k)). */
const EXACT_SILHOUETTE_LIMIT = 1500;

/**
 * Mean silhouette of a clustering: how much closer each point is to its own cluster than to the
 * next one, from −1 to 1. Exact for personal-sized vaults; above 1,500 notes the simplified form
 * (distances to centres instead of to every point) keeps it cheap, at the cost of favouring more,
 * smaller clusters.
 */
export function silhouette(points: Points, result: KMeansResult, distances: Float32Array | null = pairwiseDistances(points)): number {
  if (result.k < 2) return 0;
  return distances ? exactSilhouette(points.count, result, distances) : simplifiedSilhouette(points, result);
}

/** All pairwise distances (row-major n × n), or null above the exact-silhouette limit. Computed once per clustering. */
export function pairwiseDistances(points: Points): Float32Array | null {
  const { data, count, dims } = points;
  if (count > EXACT_SILHOUETTE_LIMIT) return null;
  const distances = new Float32Array(count * count);
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let d2 = 0;
      for (let d = 0; d < dims; d++) d2 += ((data[i * dims + d] ?? 0) - (data[j * dims + d] ?? 0)) ** 2;
      const distance = Math.sqrt(d2);
      distances[i * count + j] = distance;
      distances[j * count + i] = distance;
    }
  }
  return distances;
}

function exactSilhouette(count: number, result: KMeansResult, distances: Float32Array): number {
  const sizes = new Int32Array(result.k);
  for (let i = 0; i < count; i++) sizes[assignmentOf(result, i)] = (sizes[assignmentOf(result, i)] ?? 0) + 1;
  let total = 0;
  const sums = new Float64Array(result.k);
  for (let i = 0; i < count; i++) {
    sums.fill(0);
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const c = assignmentOf(result, j);
      sums[c] = (sums[c] ?? 0) + (distances[i * count + j] ?? 0);
    }
    const own = assignmentOf(result, i);
    const ownSize = (sizes[own] ?? 0) - 1;
    if (ownSize === 0) continue; // a singleton scores 0 by convention
    const a = (sums[own] ?? 0) / ownSize;
    let b = Number.POSITIVE_INFINITY;
    for (let c = 0; c < result.k; c++) if (c !== own && (sizes[c] ?? 0) > 0) b = Math.min(b, (sums[c] ?? 0) / (sizes[c] ?? 1));
    total += (b - a) / Math.max(a, b);
  }
  return total / count;
}

function simplifiedSilhouette(points: Points, result: KMeansResult): number {
  let total = 0;
  for (let i = 0; i < points.count; i++) {
    const own = assignmentOf(result, i);
    const a = Math.sqrt(distance2(points, i, result.centroids, own));
    let b = Number.POSITIVE_INFINITY;
    for (let c = 0; c < result.k; c++) if (c !== own) b = Math.min(b, Math.sqrt(distance2(points, i, result.centroids, c)));
    const denominator = Math.max(a, b);
    total += denominator === 0 ? 0 : (b - a) / denominator;
  }
  return total / points.count;
}

function assignmentOf(result: KMeansResult, i: number): number {
  return result.assignments[i] ?? 0;
}

export interface ChooseKResult extends KMeansResult {
  silhouette: number;
  /** Silhouette for every k tried. */
  tried: { k: number; silhouette: number }[];
}

/**
 * Picks k by silhouette over √n/2 … 2√n (PLAN §7.4), capped at `maxK`. Each k is clustered with
 * the same seed, so the choice is reproducible.
 */
export function chooseK(points: Points, seed = 1, maxK = 40): ChooseKResult {
  const root = Math.sqrt(points.count);
  const low = Math.max(2, Math.floor(root / 2));
  const high = Math.max(low, Math.min(maxK, Math.ceil(root * 2), points.count - 1));
  let best: ChooseKResult | null = null;
  const tried: { k: number; silhouette: number }[] = [];
  const distances = pairwiseDistances(points);
  for (let k = low; k <= high; k++) {
    const result = kmeans(points, k, seed);
    const score = silhouette(points, result, distances);
    tried.push({ k, silhouette: score });
    if (!best || score > best.silhouette) best = { ...result, silhouette: score, tried };
  }
  if (!best) {
    const single = kmeans(points, 1, seed);
    return { ...single, silhouette: 0, tried };
  }
  return { ...best, tried };
}
