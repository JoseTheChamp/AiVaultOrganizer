import type { NoteRecord } from '../model/note';
import type { Clustering } from './clusters';
import { DATED_NAME } from './stats';

export interface LinkCandidate {
  source: string;
  target: string;
  /** Ranking score: similarity plus graph and tag evidence. */
  score: number;
  similarity: number;
  sharedTags: number;
  /** Adamic–Adar index: shared neighbours, rarer ones counting more. */
  sharedNeighbors: number;
}

export interface CandidateOptions {
  /** Suggestions per note (PLAN §7.5: 8). */
  k: number;
  /** Pairs less similar than this are never suggested. */
  floor: number;
  /** Besides its own cluster, search this many nearest clusters. */
  probe: number;
  /** Weight of each shared tag and of the Adamic–Adar index in the score. */
  tagWeight: number;
  neighborWeight: number;
}

export const DEFAULT_CANDIDATES: CandidateOptions = { k: 8, floor: 0.2, probe: 2, tagWeight: 0.03, neighborWeight: 0.05 };

export interface CandidateInput {
  notes: readonly NoteRecord[];
  /** Cosine similarity of two notes, from word statistics or embeddings. */
  similarity: (a: string, b: string) => number;
  /** When given, each note is compared only with its own and the nearest clusters. */
  clustering?: Clustering;
  /** Pairs never to suggest: rejected before, or involving ignored or private notes. */
  exclude?: (source: string, target: string) => boolean;
}

/**
 * Link suggestion candidates (PLAN §7.5 steps 1–2): for each note, the most similar notes it is not
 * linked with yet, ranked by similarity plus shared tags and shared link neighbours (Adamic–Adar).
 * With a clustering, the search is restricted to the note's cluster and its nearest clusters, which
 * keeps it fast on large vaults and is a light form of the IVF index the plan describes. Daily
 * notes neither get nor become suggestions; a "related" list in a journal entry is noise.
 */
export function linkCandidates(input: CandidateInput, options: CandidateOptions = DEFAULT_CANDIDATES): Map<string, LinkCandidate[]> {
  const notes = input.notes.filter((note) => !DATED_NAME.test(note.basename));
  const byPath = new Map(input.notes.map((note) => [note.path, note]));
  const neighbors = new Map(input.notes.map((note) => [note.path, new Set([...note.outLinks, ...note.inLinks])]));
  const pools = candidatePools(notes.map((note) => note.path), input.clustering, options.probe);
  const eligible = new Set(notes.map((note) => note.path));

  const result = new Map<string, LinkCandidate[]>();
  for (const note of notes) {
    const linked = neighbors.get(note.path) ?? new Set<string>();
    const tags = new Set(note.tags.map((tag) => tag.toLowerCase()));
    const candidates: LinkCandidate[] = [];
    for (const target of pools.get(note.path) ?? []) {
      if (target === note.path || !eligible.has(target) || linked.has(target) || input.exclude?.(note.path, target)) continue;
      const similarity = input.similarity(note.path, target);
      if (similarity < options.floor) continue;
      const other = byPath.get(target);
      const sharedTags = other ? other.tags.filter((tag) => tags.has(tag.toLowerCase())).length : 0;
      const sharedNeighbors = adamicAdar(linked, neighbors.get(target) ?? new Set(), neighbors);
      candidates.push({
        source: note.path,
        target,
        score: similarity + options.tagWeight * sharedTags + options.neighborWeight * sharedNeighbors,
        similarity,
        sharedTags,
        sharedNeighbors,
      });
    }
    candidates.sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1));
    result.set(note.path, candidates.slice(0, options.k));
  }
  return result;
}

/** Σ over shared neighbours z of 1 / ln(degree z): a common friend who knows few people says more. */
function adamicAdar(a: ReadonlySet<string>, b: ReadonlySet<string>, neighbors: ReadonlyMap<string, ReadonlySet<string>>): number {
  let sum = 0;
  for (const z of a) {
    if (!b.has(z)) continue;
    const degree = neighbors.get(z)?.size ?? 0;
    if (degree > 1) sum += 1 / Math.log(degree);
  }
  return sum;
}

/** Which notes each note is compared with: everything, or its cluster and the nearest ones. */
function candidatePools(paths: readonly string[], clustering: Clustering | undefined, probe: number): Map<string, readonly string[]> {
  if (!clustering || clustering.clusters.length <= 1 + probe) return new Map(paths.map((path) => [path, paths]));
  const { points, centroids, assignments } = clustering;
  const dims = points.dims;
  const k = clustering.clusters.length;
  const members = new Map(clustering.clusters.map((cluster) => [cluster.id, cluster.members]));
  const rowOf = new Map(clustering.paths.map((path, row) => [path, row]));
  const pools = new Map<string, readonly string[]>();
  for (const path of paths) {
    const row = rowOf.get(path);
    const own = assignments.get(path);
    if (row === undefined || own === undefined) {
      pools.set(path, paths);
      continue;
    }
    const nearest = Array.from({ length: k }, (_, c) => {
      let distance = 0;
      for (let d = 0; d < dims; d++) distance += ((points.data[row * dims + d] ?? 0) - (centroids[c * dims + d] ?? 0)) ** 2;
      return { c, distance };
    })
      .filter(({ c }) => c !== own)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, probe)
      .map(({ c }) => c);
    pools.set(path, [own, ...nearest].flatMap((c) => members.get(c) ?? []));
  }
  return pools;
}
