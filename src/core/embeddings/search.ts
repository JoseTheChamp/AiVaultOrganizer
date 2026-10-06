import { type Neighbor, topK } from './top-k';

/** Unit-length note vectors as one row-major matrix; row i belongs to `paths[i]`. */
export interface DenseIndex {
  paths: readonly string[];
  dims: number;
  matrix: Float32Array;
}

/**
 * Exact top-k cosine search over unit vectors, which is a dot product per note (PLAN §7.3). Brute
 * force is fast enough for personal vaults: 5,000 notes × 1,024 dimensions is about 5 million
 * multiply-adds, a few milliseconds; it runs in a worker so even that never blocks the UI.
 */
export class DenseSearch {
  private readonly rowOf = new Map<string, number>();

  constructor(private readonly index: DenseIndex) {
    if (index.matrix.length !== index.paths.length * index.dims) throw new Error('Matrix size does not match paths × dims.');
    index.paths.forEach((path, row) => this.rowOf.set(path, row));
  }

  get size(): number {
    return this.index.paths.length;
  }

  has(path: string): boolean {
    return this.rowOf.has(path);
  }

  /** Cosine similarity of two indexed notes (0 when either is unknown). */
  similarity(a: string, b: string): number {
    const left = this.rowOf.get(a);
    const right = this.rowOf.get(b);
    if (left === undefined || right === undefined) return 0;
    const { dims, matrix } = this.index;
    let sum = 0;
    for (let d = 0; d < dims; d++) sum += (matrix[left * dims + d] ?? 0) * (matrix[right * dims + d] ?? 0);
    return sum;
  }

  /** Notes most similar to an indexed note, best first, excluding itself and `exclude`. */
  similar(path: string, k: number, exclude: ReadonlySet<string> = new Set()): Neighbor[] {
    const row = this.rowOf.get(path);
    if (row === undefined) return [];
    const { dims, matrix } = this.index;
    return this.search(matrix.subarray(row * dims, (row + 1) * dims), k, (index) => index === row || exclude.has(this.index.paths[index] ?? ''));
  }

  /** Notes most similar to a unit query vector. */
  nearest(query: Float32Array, k: number, exclude: ReadonlySet<string> = new Set()): Neighbor[] {
    if (query.length !== this.index.dims) throw new Error(`Expected a ${this.index.dims}-dimensional query.`);
    return this.search(query, k, (index) => exclude.has(this.index.paths[index] ?? ''));
  }

  private search(query: Float32Array, k: number, skip: (index: number) => boolean): Neighbor[] {
    const { paths, dims, matrix } = this.index;
    const scores = new Float32Array(paths.length);
    for (let row = 0; row < paths.length; row++) {
      let dot = 0;
      const offset = row * dims;
      for (let d = 0; d < dims; d++) dot += (matrix[offset + d] ?? 0) * (query[d] ?? 0);
      scores[row] = dot;
    }
    return topK(scores, k, skip).map(({ index, score }) => ({ path: paths[index] ?? '', score }));
  }
}

/** Messages between the plugin and the search worker. */
export type SearchRequest =
  | { id: number; type: 'load'; paths: string[]; dims: number; matrix: Float32Array }
  | { id: number; type: 'similar'; path: string; k: number; exclude: string[] };

export type SearchResponse = { id: number; type: 'loaded'; size: number } | { id: number; type: 'result'; neighbors: Neighbor[] } | { id: number; type: 'error'; message: string };

/**
 * The worker's side of the protocol as a plain function, so it can be tested without a worker and
 * reused as the main-thread fallback.
 */
export function createSearchHandler(): (request: SearchRequest) => SearchResponse {
  let search: DenseSearch | null = null;
  return (request) => {
    try {
      if (request.type === 'load') {
        search = new DenseSearch({ paths: request.paths, dims: request.dims, matrix: request.matrix });
        return { id: request.id, type: 'loaded', size: search.size };
      }
      if (!search) return { id: request.id, type: 'error', message: 'No index is loaded.' };
      return { id: request.id, type: 'result', neighbors: search.similar(request.path, request.k, new Set(request.exclude)) };
    } catch (error) {
      return { id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
}
