export interface NeighborQuality {
  /** Notes that had at least one neighbour. */
  notes: number;
  k: number;
  /** Mean share of a note's top-k neighbours that share its topic (1 = perfect). */
  precision: number;
  /** Mean share of top-k neighbours that share the topic but are written in the other language. */
  crossLanguage: number;
}

/**
 * Topic precision@k of a similarity method against a vault's ground truth: a sanity measure for
 * "similar notes look right" that can be compared across methods (word statistics vs. embeddings).
 */
export function neighborQuality(
  neighbors: ReadonlyMap<string, readonly string[]>,
  topics: Readonly<Record<string, string>>,
  languages: Readonly<Record<string, string>>,
  k: number,
): NeighborQuality {
  let notes = 0;
  let precision = 0;
  let crossLanguage = 0;
  for (const [path, list] of neighbors) {
    const top = list.slice(0, k);
    if (top.length === 0) continue;
    notes++;
    const same = top.filter((other) => topics[other] === topics[path]);
    precision += same.length / top.length;
    crossLanguage += same.filter((other) => languages[other] !== languages[path]).length / top.length;
  }
  return { notes, k, precision: notes ? precision / notes : 0, crossLanguage: notes ? crossLanguage / notes : 0 };
}
