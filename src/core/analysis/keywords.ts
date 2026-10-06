import { tokens } from '../embeddings/tfidf';
import type { Cluster } from './clusters';

export interface ClusterKeywords {
  id: number;
  /** Most distinctive words first, as people write them. */
  keywords: string[];
}

export interface KeywordOptions {
  top: number;
  /** In clusters of at least 3 notes, a keyword must appear in this many of them. */
  minNotes: number;
}

export const DEFAULT_KEYWORDS: KeywordOptions = { top: 8, minNotes: 2 };

/**
 * Keywords per cluster by class-based TF-IDF (c-TF-IDF, as in BERTopic; PLAN §7.4): each cluster's
 * text is one document, and a term scores tf(t, c) · log(1 + A / f(t)), where A is the average
 * number of terms per cluster and f(t) the term's frequency across all clusters. Words common
 * everywhere sink; words concentrated in one cluster rise. Terms are stems (see `terms`), shown as
 * the most frequent word that produced them.
 */
export function clusterKeywords(clusters: readonly Cluster[], texts: ReadonlyMap<string, string>, options: KeywordOptions = DEFAULT_KEYWORDS): ClusterKeywords[] {
  const perCluster = clusters.map((cluster) => {
    const counts = new Map<string, number>();
    const notes = new Map<string, number>();
    const surfaces = new Map<string, Map<string, number>>();
    for (const path of cluster.members) {
      const seen = new Set<string>();
      for (const { term, word } of tokens(texts.get(path) ?? '')) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
        if (!seen.has(term)) notes.set(term, (notes.get(term) ?? 0) + 1);
        seen.add(term);
        let forms = surfaces.get(term);
        if (!forms) surfaces.set(term, (forms = new Map<string, number>()));
        forms.set(word, (forms.get(word) ?? 0) + 1);
      }
    }
    return { cluster, counts, notes, surfaces };
  });

  const total = new Map<string, number>();
  let allTerms = 0;
  for (const { counts } of perCluster) {
    for (const [term, count] of counts) {
      total.set(term, (total.get(term) ?? 0) + count);
      allTerms += count;
    }
  }
  const average = perCluster.length === 0 ? 0 : allTerms / perCluster.length;

  return perCluster.map(({ cluster, counts, notes, surfaces }) => {
    const minNotes = cluster.members.length >= 3 ? options.minNotes : 1;
    const scored = [...counts]
      .filter(([term]) => (notes.get(term) ?? 0) >= minNotes)
      .map(([term, count]) => ({ term, score: count * Math.log(1 + average / (total.get(term) ?? 1)) }))
      .sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1))
      .slice(0, options.top);
    return { id: cluster.id, keywords: scored.map(({ term }) => commonest(surfaces.get(term)) ?? term) };
  });
}

function commonest(forms: ReadonlyMap<string, number> | undefined): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [word, count] of forms ?? []) {
    if (count > bestCount || (count === bestCount && best !== undefined && word < best)) {
      best = word;
      bestCount = count;
    }
  }
  return best;
}
