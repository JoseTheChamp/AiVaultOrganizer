import type { Neighbor } from '../embeddings/top-k';
import { jaccard, lshCandidates, MinHasher, shingles, words } from './minhash';
import { DATED_NAME } from './stats';

export interface DuplicateInput {
  path: string;
  title: string;
  /** Prepared body text (no frontmatter, code or syntax). */
  text: string;
}

export interface DuplicateOptions {
  /** Shingle overlap that makes a pair a Tier 0 candidate. */
  minJaccard: number;
  /** Embedding similarity that makes a pair a Tier 1 candidate (PLAN §7.4: 0.92). */
  minCosine: number;
  /** Title similarity that confirms a candidate. */
  minTitle: number;
  /** Content this close is a duplicate whatever the titles say. */
  strongJaccard: number;
  strongCosine: number;
}

export const DEFAULT_DUPLICATES: DuplicateOptions = { minJaccard: 0.2, minCosine: 0.85, minTitle: 0.5, strongJaccard: 0.8, strongCosine: 0.97 };

export interface DuplicatePair {
  a: string;
  b: string;
  /** Shingle Jaccard (always measured on the candidates). */
  jaccard: number;
  /** Embedding cosine, when embeddings were used. */
  cosine?: number;
  /** Dice overlap of the title words. */
  title: number;
  /** 0..1 belief that this is a duplicate. */
  confidence: number;
}

/**
 * Near-duplicate notes (PLAN §7.4). Candidates come from MinHash over 5-word shingles (Tier 0) and,
 * when given, nearest embedding neighbours (Tier 1). A candidate counts only when the titles agree
 * or the content is nearly identical: notes on one topic can share whole sentences and score high
 * on similarity alone, but a copy usually keeps its title ("Plan" vs "Plan (copy)"). Daily notes
 * are never duplicates of each other; they follow the same template by design.
 */
export function findDuplicates(
  notes: readonly DuplicateInput[],
  neighbors?: (path: string) => readonly Neighbor[],
  options: DuplicateOptions = DEFAULT_DUPLICATES,
): DuplicatePair[] {
  const eligible = notes.filter((note) => !DATED_NAME.test(note.title));
  const byPath = new Map(eligible.map((note) => [note.path, note]));
  const sets = new Map(eligible.map((note) => [note.path, shingles(note.text)]));
  const hasher = new MinHasher();
  const signatures = new Map([...sets].filter(([, set]) => set.size > 0).map(([path, set]) => [path, hasher.signature(set)]));

  const candidates = new Map<string, { a: string; b: string; cosine?: number }>();
  const key = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const [a, b] of lshCandidates(signatures)) candidates.set(key(a, b), { a, b });
  if (neighbors) {
    for (const note of eligible) {
      for (const neighbor of neighbors(note.path)) {
        if (neighbor.score < options.minCosine || !byPath.has(neighbor.path) || neighbor.path === note.path) continue;
        const [a, b] = note.path < neighbor.path ? [note.path, neighbor.path] : [neighbor.path, note.path];
        candidates.set(key(a, b), { a, b, cosine: neighbor.score });
      }
    }
  }

  const pairs: DuplicatePair[] = [];
  for (const { a, b, cosine } of candidates.values()) {
    const shingleJaccard = jaccard(sets.get(a) ?? new Set(), sets.get(b) ?? new Set());
    const title = titleSimilarity(byPath.get(a)?.title ?? '', byPath.get(b)?.title ?? '');
    const contentCandidate = shingleJaccard >= options.minJaccard || (cosine !== undefined && cosine >= options.minCosine);
    const strong = shingleJaccard >= options.strongJaccard || (cosine !== undefined && cosine >= options.strongCosine);
    if (!contentCandidate || (!strong && title < options.minTitle)) continue;
    const content = Math.max(shingleJaccard, cosine === undefined ? 0 : (cosine - options.minCosine) / (1 - options.minCosine));
    pairs.push({ a, b, jaccard: shingleJaccard, ...(cosine === undefined ? {} : { cosine }), title, confidence: Math.min(1, 0.5 * content + 0.5 * Math.max(title, strong ? 1 : 0)) });
  }
  return pairs.sort((x, y) => y.confidence - x.confidence || (x.a < y.a ? -1 : 1));
}

/** Dice coefficient of title words: "Launch checklist" vs "Launch checklist v2" is 0.8. */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return (2 * shared) / (left.size + right.size);
}
