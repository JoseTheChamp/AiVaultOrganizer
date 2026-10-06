import type { PreparedNote } from './prepare';
import { preparedText } from './prepare';
import { type Neighbor, topK } from './top-k';

/** Term → count in one note. */
export type TermCounts = Record<string, number>;

// Folded (no diacritics, lower case), so they match the output of `terms()` before stemming.
const STOPWORDS = new Set(
  [
    // English
    'the and for are but not you all any can had her was one our out has have his how its may new now old see two way who did get let put say she too use that with this from they will would there their what about which when make like time just know take into year your good some could them than then look only come over think also back after work first well even want because these give most very been were said each where much before here through such being does down should while those both under never same another again might still between',
    // Czech (folded)
    'ale ani bez byl byla byli bylo byt jak jako jsem jsi jsme jste jsou jeho jeji jejich jen jenz jiz jine kde kdo kdyz kam ktera ktere ktery kteri kteremu kterou mezi mne mnou muj moje musi mam mate mel mela nam nas nebo neni nez nic nim nich pak pod podle pokud potom pred pres pri pro proc proto protoze sve svuj tak take tato tedy tento tim tom tomu toto tuto ted vam vas vice vsak vse vsechno zde budu bude budou bych bychom byste aby abych tech techto timto jeste jenom asi takze tady tam',
  ]
    .join(' ')
    .split(/\s+/),
);

const WORD = /\p{L}[\p{L}\p{N}]*/gu;
/** Prefix length for truncation stemming. */
const STEM_LENGTH = 6;

/**
 * Words of a text as index terms: diacritics folded, lower case, stopwords and words shorter than
 * three letters dropped, then truncated to six letters. Truncation is a crude stemmer, but it works
 * well for heavily inflected languages such as Czech (zahrada, zahrady, zahradě → zahrad) and keeps
 * English word families together (garden, gardening), without a language-specific stemmer.
 */
export function terms(text: string): string[] {
  return tokens(text).map((token) => token.term);
}

/** Index terms with the word each came from (lower case, diacritics kept), for showing keywords. */
export function tokens(text: string): { term: string; word: string }[] {
  const result: { term: string; word: string }[] = [];
  for (const word of text.normalize('NFC').toLowerCase().match(WORD) ?? []) {
    const folded = word.normalize('NFD').replace(/\p{Mn}/gu, '');
    if (folded.length < 3 || STOPWORDS.has(folded)) continue;
    // A plural "s" would otherwise survive truncation for short words (beds, tags).
    const singular = folded.length >= 4 && folded.endsWith('s') && !folded.endsWith('ss') ? folded.slice(0, -1) : folded;
    result.push({ term: singular.slice(0, STEM_LENGTH), word });
  }
  return result;
}

/** How much a word counts depending on where it appears: the title says most about a note. */
const TITLE_WEIGHT = 3;
const TAG_WEIGHT = 2;

/** Term counts of a prepared note plus its tags (tag paths split into words). */
export function countTerms(note: PreparedNote, tags: readonly string[] = []): TermCounts {
  const counts: TermCounts = {};
  const add = (text: string, weight: number): void => {
    for (const term of terms(text)) counts[term] = (counts[term] ?? 0) + weight;
  };
  add(note.title, TITLE_WEIGHT - 1); // preparedText includes the title once more
  add(preparedText(note), 1);
  for (const tag of tags) add(tag.replace(/[/_-]+/g, ' '), TAG_WEIGHT);
  return counts;
}

/**
 * TF-IDF vectors with cosine similarity: Tier 0 similarity that needs no model (PLAN §7.1). Weights
 * use sublinear term frequency (1 + ln tf) and smoothed inverse document frequency, so a word that
 * appears everywhere counts for little and repeating a word has diminishing returns.
 */
export class TfidfModel {
  private readonly index = new Map<string, number>();
  /** term → postings of (document, normalized weight). */
  private readonly postings = new Map<string, { doc: number; weight: number }[]>();
  private readonly vectors: Map<string, number>[] = [];

  private constructor(readonly paths: readonly string[]) {}

  static build(documents: ReadonlyMap<string, TermCounts>): TfidfModel {
    const paths = [...documents.keys()].sort();
    const model = new TfidfModel(paths);
    const df = new Map<string, number>();
    for (const counts of documents.values()) for (const term of Object.keys(counts)) df.set(term, (df.get(term) ?? 0) + 1);
    const n = paths.length;
    paths.forEach((path, doc) => {
      model.index.set(path, doc);
      const vector = new Map<string, number>();
      let norm = 0;
      for (const [term, count] of Object.entries(documents.get(path) ?? {})) {
        if (count <= 0) continue;
        const weight = (1 + Math.log(count)) * (Math.log((1 + n) / (1 + (df.get(term) ?? 0))) + 1);
        vector.set(term, weight);
        norm += weight * weight;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [term, weight] of vector) {
        const normalized = weight / norm;
        vector.set(term, normalized);
        let list = model.postings.get(term);
        if (!list) model.postings.set(term, (list = []));
        list.push({ doc, weight: normalized });
      }
      model.vectors.push(vector);
    });
    return model;
  }

  has(path: string): boolean {
    return this.index.has(path);
  }

  /** Cosine similarity of two indexed notes (0 when either is unknown). */
  similarity(a: string, b: string): number {
    const left = this.vector(a);
    const right = this.vector(b);
    if (!left || !right) return 0;
    const [small, large] = left.size <= right.size ? [left, right] : [right, left];
    let sum = 0;
    for (const [term, weight] of small) sum += weight * (large.get(term) ?? 0);
    return sum;
  }

  /** A note's unit-length TF-IDF vector as term → weight. */
  vector(path: string): ReadonlyMap<string, number> | undefined {
    const doc = this.index.get(path);
    return doc === undefined ? undefined : this.vectors[doc];
  }

  /** The `k` notes most similar to `path`, best first, excluding itself and anything in `exclude`. */
  similar(path: string, k: number, exclude: ReadonlySet<string> = new Set()): Neighbor[] {
    const doc = this.index.get(path);
    const query = doc === undefined ? undefined : this.vectors[doc];
    if (doc === undefined || !query) return [];
    const scores = new Float64Array(this.paths.length);
    for (const [term, weight] of query) {
      for (const posting of this.postings.get(term) ?? []) scores[posting.doc] = (scores[posting.doc] ?? 0) + weight * posting.weight;
    }
    return topK(scores, k, (index) => index === doc || (scores[index] ?? 0) <= 0 || exclude.has(this.paths[index] ?? ''))
      .map(({ index, score }) => ({ path: this.paths[index] ?? '', score }));
  }
}
