/**
 * MinHash over word shingles (PLAN §7.4): a compact signature whose agreement estimates the Jaccard
 * similarity of two notes' shingle sets, plus locality-sensitive hashing to find candidate pairs
 * without comparing every note with every other.
 */

const WORD = /[\p{L}\p{N}]+/gu;

/** Lower-case, diacritic-free words; stopwords stay, because phrases are what shingles compare. */
export function words(text: string): string[] {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().match(WORD) ?? [];
}

/** Every run of `size` consecutive words; a shorter text is one shingle. */
export function shingles(text: string, size = 5): Set<string> {
  const list = words(text);
  const result = new Set<string>();
  if (list.length === 0) return result;
  if (list.length <= size) {
    result.add(list.join(' '));
    return result;
  }
  for (let i = 0; i + size <= list.length; i++) result.add(list.slice(i, i + size).join(' '));
  return result;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

/** FNV-1a: a fast, well-spread 32-bit hash of a string. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** Murmur3's finalizer: turns a seeded value into an independent-looking 32-bit hash. */
function mix(value: number): number {
  let h = value;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class MinHasher {
  private readonly seeds: Uint32Array;

  constructor(
    readonly size = 128,
    seed = 0x9e3779b9,
  ) {
    this.seeds = new Uint32Array(size);
    let state = seed >>> 0;
    for (let i = 0; i < size; i++) {
      state = mix(state + 0x6d2b79f5);
      this.seeds[i] = state;
    }
  }

  /** The minimum of each of `size` hash functions over the shingles. */
  signature(set: ReadonlySet<string>): Uint32Array {
    const signature = new Uint32Array(this.size).fill(0xffffffff);
    for (const shingle of set) {
      const base = fnv1a(shingle);
      for (let i = 0; i < this.size; i++) {
        const value = mix(base ^ (this.seeds[i] ?? 0));
        if (value < (signature[i] ?? 0xffffffff)) signature[i] = value;
      }
    }
    return signature;
  }
}

/** Share of agreeing positions: an unbiased estimate of the Jaccard similarity. */
export function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return a.length === 0 ? 0 : same / a.length;
}

/**
 * Candidate pairs by banding: signatures are cut into `bands` bands of `rows` values, and notes that
 * agree on a whole band share a bucket. With 64 bands of 2, a pair with Jaccard 0.2 becomes a
 * candidate with probability 0.93 and one with 0.05 with 0.15. Recall matters more than precision
 * here: candidates are checked exactly afterwards, and short paraphrased notes overlap little.
 */
export function lshCandidates(signatures: ReadonlyMap<string, Uint32Array>, bands = 64, rows = 2): [string, string][] {
  const pairs = new Map<string, [string, string]>();
  for (let band = 0; band < bands; band++) {
    const buckets = new Map<string, string[]>();
    for (const [path, signature] of signatures) {
      const key = Array.from(signature.subarray(band * rows, (band + 1) * rows)).join(',');
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = []));
      bucket.push(path);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      bucket.sort();
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i] as string;
          const b = bucket[j] as string;
          pairs.set(`${a}\u0000${b}`, [a, b]);
        }
      }
    }
  }
  return [...pairs.values()].sort((x, y) => (x[0] + x[1] < y[0] + y[1] ? -1 : 1));
}
