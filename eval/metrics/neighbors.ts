export interface NeighborQuality {
  /** Notes that were queried. */
  queries: number;
  /** Queried notes that got at least one neighbour. */
  answered: number;
  k: number;
  /** Precision@k: mean share of the k slots filled by a same-topic note (missing results count as misses). */
  precision: number;
  /** Mean share of the k slots filled by a same-topic note written in the other language. */
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
  let answered = 0;
  let precision = 0;
  let crossLanguage = 0;
  for (const [path, list] of neighbors) {
    const top = list.slice(0, k);
    if (top.length > 0) answered++;
    const same = top.filter((other) => topics[other] === topics[path]);
    precision += same.length / k;
    crossLanguage += same.filter((other) => languages[other] !== languages[path]).length / k;
  }
  const queries = neighbors.size;
  return { queries, answered, k, precision: queries ? precision / queries : 0, crossLanguage: queries ? crossLanguage / queries : 0 };
}
