import { gaussian, mulberry32 } from '../model/random';

/**
 * A data matrix seen only through products with vectors, so one PCA serves dense embeddings and
 * sparse TF-IDF vectors (where it becomes latent semantic analysis) without materializing either.
 */
export interface MatrixOperator {
  rows: number;
  cols: number;
  /** A·v for v of length `cols`. */
  multiply(v: Float64Array): Float64Array;
  /** Aᵀ·u for u of length `rows`. */
  multiplyTransposed(u: Float64Array): Float64Array;
}

/** Row-major dense matrix (e.g. note embeddings). */
export function denseOperator(matrix: Float32Array, rows: number, cols: number): MatrixOperator {
  return {
    rows,
    cols,
    multiply(v) {
      const out = new Float64Array(rows);
      for (let r = 0; r < rows; r++) {
        let sum = 0;
        const offset = r * cols;
        for (let c = 0; c < cols; c++) sum += (matrix[offset + c] ?? 0) * (v[c] ?? 0);
        out[r] = sum;
      }
      return out;
    },
    multiplyTransposed(u) {
      const out = new Float64Array(cols);
      for (let r = 0; r < rows; r++) {
        const weight = u[r] ?? 0;
        if (weight === 0) continue;
        const offset = r * cols;
        for (let c = 0; c < cols; c++) out[c] = (out[c] ?? 0) + (matrix[offset + c] ?? 0) * weight;
      }
      return out;
    },
  };
}

/** Sparse rows as (column, value) lists (e.g. TF-IDF weights over a vocabulary). */
export function sparseOperator(rows: readonly (readonly [number, number])[][], cols: number): MatrixOperator {
  return {
    rows: rows.length,
    cols,
    multiply(v) {
      const out = new Float64Array(rows.length);
      rows.forEach((row, r) => {
        let sum = 0;
        for (const [c, value] of row) sum += value * (v[c] ?? 0);
        out[r] = sum;
      });
      return out;
    },
    multiplyTransposed(u) {
      const out = new Float64Array(cols);
      rows.forEach((row, r) => {
        const weight = u[r] ?? 0;
        if (weight === 0) return;
        for (const [c, value] of row) out[c] = (out[c] ?? 0) + value * weight;
      });
      return out;
    },
  };
}

export interface PcaOptions {
  components: number;
  /** Extra random directions; they make the leading components accurate. */
  oversample: number;
  /** Power iterations; each sharpens the separation of strong and weak directions. */
  iterations: number;
  seed: number;
}

export const DEFAULT_PCA: PcaOptions = { components: 64, oversample: 8, iterations: 3, seed: 7 };

export interface PcaResult {
  /** Row-major `rows × components` coordinates of each row on the principal axes. */
  scores: Float64Array;
  components: number;
  /** Variance along each axis, largest first. */
  variances: number[];
}

/**
 * Principal component analysis by randomized SVD with power iteration (Halko, Martinsson, Tropp):
 * project the centred data onto a few random directions, sharpen them with A·Aᵀ, orthonormalize,
 * and solve the small remaining eigenproblem exactly. Two passes over the data per iteration, so
 * a 5,000 × 1,024 matrix reduces to 64 dimensions in about a second; deterministic for a seed.
 */
export function pca(operator: MatrixOperator, options: PcaOptions = DEFAULT_PCA): PcaResult {
  const { rows, cols } = operator;
  const components = Math.max(1, Math.min(options.components, rows, cols));
  const width = Math.min(components + options.oversample, rows, cols);

  // Centring without materializing: (A − 1μᵀ)v = Av − (μ·v)1 and (A − 1μᵀ)ᵀu = Aᵀu − μ(1·u).
  const mean = operator.multiplyTransposed(new Float64Array(rows).fill(1 / rows));
  const multiply = (v: Float64Array): Float64Array => {
    const out = operator.multiply(v);
    const shift = dot(mean, v);
    for (let r = 0; r < rows; r++) out[r] = (out[r] ?? 0) - shift;
    return out;
  };
  const multiplyTransposed = (u: Float64Array): Float64Array => {
    const out = operator.multiplyTransposed(u);
    let total = 0;
    for (const value of u) total += value;
    for (let c = 0; c < cols; c++) out[c] = (out[c] ?? 0) - (mean[c] ?? 0) * total;
    return out;
  };

  const normal = gaussian(mulberry32(options.seed));
  let basis: Float64Array[] = Array.from({ length: width }, () => multiply(Float64Array.from({ length: cols }, normal)));
  orthonormalize(basis);
  for (let i = 0; i < options.iterations; i++) {
    basis = basis.map((q) => multiply(multiplyTransposed(q)));
    orthonormalize(basis);
  }

  // B = Qᵀ·A is small (width × cols); the eigenvectors of B·Bᵀ rotate Q onto the principal axes.
  const projected = basis.map((q) => multiplyTransposed(q));
  const gram = Array.from({ length: width }, (_, i) => Array.from({ length: width }, (_, j) => dot(projected[i] as Float64Array, projected[j] as Float64Array)));
  const { values, vectors } = symmetricEigen(gram);
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value).slice(0, components);

  const scores = new Float64Array(rows * components);
  order.forEach(({ value, index }, k) => {
    const singular = Math.sqrt(Math.max(0, value));
    for (let j = 0; j < width; j++) {
      const weight = (vectors[j]?.[index] ?? 0) * singular;
      if (weight === 0) continue;
      const q = basis[j] as Float64Array;
      for (let r = 0; r < rows; r++) scores[r * components + k] = (scores[r * components + k] ?? 0) + (q[r] ?? 0) * weight;
    }
  });
  return { scores, components, variances: order.map(({ value }) => value / Math.max(1, rows - 1)) };
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** Modified Gram–Schmidt in place; vectors that collapse to zero stay zero. */
function orthonormalize(vectors: Float64Array[]): void {
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i] as Float64Array;
    for (let j = 0; j < i; j++) {
      const u = vectors[j] as Float64Array;
      const projection = dot(u, v);
      for (let k = 0; k < v.length; k++) v[k] = (v[k] ?? 0) - projection * (u[k] ?? 0);
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm > 1e-12) for (let k = 0; k < v.length; k++) v[k] = (v[k] ?? 0) / norm;
    else v.fill(0);
  }
}

/** Eigen-decomposition of a small symmetric matrix by cyclic Jacobi rotations. */
export function symmetricEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const at = (m: number[][], i: number, j: number): number => m[i]?.[j] ?? 0;
  const set = (m: number[][], i: number, j: number, value: number): void => {
    const row = m[i];
    if (row) row[j] = value;
  };
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += at(a, i, j) ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = at(a, p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (at(a, q, q) - at(a, p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = at(a, k, p);
          const akq = at(a, k, q);
          set(a, k, p, c * akp - s * akq);
          set(a, k, q, s * akp + c * akq);
        }
        for (let k = 0; k < n; k++) {
          const apk = at(a, p, k);
          const aqk = at(a, q, k);
          set(a, p, k, c * apk - s * aqk);
          set(a, q, k, s * apk + c * aqk);
        }
        for (let k = 0; k < n; k++) {
          const vkp = at(v, k, p);
          const vkq = at(v, k, q);
          set(v, k, p, c * vkp - s * vkq);
          set(v, k, q, s * vkp + c * vkq);
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i] ?? 0), vectors: v };
}
