import { ProviderError, type EmbeddingProvider } from '../ai/types';
import type { VaultSnapshot } from '../model/note';
import { isPrivateNote } from '../model/privacy';
import type { Clock, Hasher, Logger, StoragePort, VaultReader } from '../ports';
import { EmbeddingIndex } from './embedding-index';
import { type IndexReport, planIndexUpdate } from './indexing';
import type { DenseIndex } from './search';
import type { Neighbor } from './top-k';
import { embeddingModelId, VectorStore } from './vector-store';
import type { TfidfModel } from './tfidf';
import { WordIndex } from './word-index';

/** Where similarity searches run (a worker inside Obsidian, in-process in tests and the CLI). */
export interface SearchBackend {
  load(index: DenseIndex): Promise<number>;
  similar(path: string, k: number, exclude?: readonly string[]): Promise<Neighbor[]>;
}

export type SimilarityMethod = 'embeddings' | 'words';

/** Why word statistics answered although an embedding model is configured. */
export type SimilarityFallback = 'private' | 'declined' | 'cancelled' | 'error' | 'not-indexed';

export interface SendEstimate {
  /** Notes whose text would be sent to the provider. */
  notes: number;
  /** Rough token count, for the consent message. */
  tokens: number;
}

export interface SimilarityQuery {
  path: string;
  k: number;
  /** The embedding provider when better similarity is on; null for word statistics only. */
  provider: EmbeddingProvider | null;
  /** Charter ignore globs: such notes are neither indexed nor returned. */
  ignore?: readonly string[];
  /** Paths never returned (the charter note, for example). */
  exclude?: readonly string[];
  onProgress?: (progress: { done: number; total: number; method: SimilarityMethod }) => void;
  isCancelled?: () => boolean;
  /** Asked before note text goes to a provider that is not on this computer; false means "use words". */
  confirmSend?: (estimate: SendEstimate) => Promise<boolean>;
}

export interface SimilarityResult {
  method: SimilarityMethod;
  neighbors: Neighbor[];
  fallback?: SimilarityFallback;
  /** Provider error message when `fallback` is `error`. */
  error?: string;
  report?: IndexReport;
}

/** What a neighbour source needs to know: `SimilarityQuery` without a note to search for. */
export type NeighborSourceQuery = Omit<SimilarityQuery, 'path' | 'k'>;

/** Neighbours of any note, from the best index available, and why it is not embeddings if so. */
export interface NeighborSource extends Omit<SimilarityResult, 'neighbors'> {
  /** A plain function: the planner passes it around on its own. */
  neighbors: (path: string, k: number) => Promise<Neighbor[]>;
}

/** A source, and whether a note is in it (notes the embedding index skipped are not). */
interface PreparedSource extends NeighborSource {
  has: (path: string) => boolean;
}

export interface SimilarityDeps {
  reader: VaultReader;
  storage: StoragePort;
  hasher: Hasher;
  clock: Clock;
  search: SearchBackend;
  logger: Logger;
}

/**
 * "Find similar notes": keeps the indexes current and answers from the best available method.
 * With an embedding model it embeds what changed (asking first when text would leave the device)
 * and searches by meaning; whenever that is not possible (no model, a private note, a declined or
 * failed run) it answers from word statistics, which always work and never leave the device.
 */
export class SimilarityEngine {
  private words: WordIndex;
  private readonly store: VectorStore;
  private readonly embeddings = new Map<string, EmbeddingIndex>();
  /** Model and generation of the vectors the search backend holds. */
  private loaded: { modelId: string; generation: number } | null = null;
  private generation = 0;
  private pruned = false;

  constructor(private readonly deps: SimilarityDeps) {
    this.words = new WordIndex(deps.storage);
    this.store = new VectorStore(deps.storage, deps.hasher);
  }

  async similar(query: SimilarityQuery): Promise<SimilarityResult> {
    const snapshot = await this.deps.reader.snapshot({ ignore: query.ignore ?? [] });
    let source: PreparedSource;
    if (query.provider && isPrivate(snapshot, query.path)) source = await this.wordSource(snapshot, query, { fallback: 'private' });
    else source = await this.source(snapshot, query);
    if (!source.has(query.path)) source = await this.wordSource(snapshot, query, { fallback: 'not-indexed', report: source.report });
    const { has: _, neighbors, ...result } = source;
    return { ...result, neighbors: await neighbors(query.path, query.k) };
  }

  /**
   * Neighbours for any note of the vault, for the planner's kNN stage: brings the best available
   * index up to date once (asking before text leaves the device, as `similar` does), then answers
   * lookups from it. Falls back to word statistics exactly when `similar` would.
   */
  async neighborSource(query: NeighborSourceQuery): Promise<NeighborSource> {
    const snapshot = await this.deps.reader.snapshot({ ignore: query.ignore ?? [] });
    const { has: _, ...source } = await this.source(snapshot, query);
    return source;
  }

  /**
   * Word statistics over the vault (the word index, brought up to date): enough to group notes for
   * the drafting agent without any model.
   */
  async wordModel(query: Pick<NeighborSourceQuery, 'ignore' | 'isCancelled' | 'onProgress'>): Promise<TfidfModel> {
    const snapshot = await this.deps.reader.snapshot({ ignore: query.ignore ?? [] });
    await this.words.update(snapshot.notes, (path) => this.deps.reader.read(path), {
      isCancelled: query.isCancelled,
      onProgress: ({ done, total }) => query.onProgress?.({ done, total, method: 'words' }),
    });
    return this.words.model(new Set(snapshot.notes.map((note) => note.path)));
  }

  /** Forgets every index; the next search rebuilds what it needs. */
  async clear(): Promise<void> {
    for (const key of await this.deps.storage.list('cache/index/')) await this.deps.storage.remove(key);
    this.words = new WordIndex(this.deps.storage);
    this.embeddings.clear();
    this.loaded = null;
  }

  private source(snapshot: VaultSnapshot, query: NeighborSourceQuery): Promise<PreparedSource> {
    return query.provider ? this.embeddingSource(snapshot, query, query.provider) : this.wordSource(snapshot, query);
  }

  private async embeddingSource(snapshot: VaultSnapshot, query: NeighborSourceQuery, provider: EmbeddingProvider): Promise<PreparedSource> {
    const index = this.embeddingIndex(provider);
    // Private notes never reach a model (PLAN §7.11).
    const eligible = snapshot.notes.filter((note) => !isPrivateNote(note.frontmatter));
    const existing = await index.vectors();
    const stored = new Map<string, string>();
    for (const [path, entry] of existing?.entries ?? []) stored.set(path, entry.contentHash);
    const stale = planIndexUpdate(eligible, stored).stale;

    if (stale.length > 0 && !provider.capabilities.local && query.confirmSend) {
      // Bytes / 3 over-estimates tokens a little, which is the right side to err on for consent.
      const estimate = { notes: stale.length, tokens: stale.reduce((sum, note) => sum + Math.ceil(note.size / 3), 0) };
      if (!(await query.confirmSend(estimate))) return this.wordSource(snapshot, query, { fallback: 'declined' });
    }

    let report: IndexReport;
    try {
      report = await index.update(eligible, (path) => this.deps.reader.read(path), {
        isCancelled: query.isCancelled,
        onProgress: ({ done, total }) => query.onProgress?.({ done, total, method: 'embeddings' }),
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      this.deps.logger.warn('Embedding failed; using word statistics.', error.message);
      return this.wordSource(snapshot, query, { fallback: 'error', error: error.message });
    }
    if (report.indexed > 0 || report.removed > 0) this.generation++;
    if (report.cancelled) return this.wordSource(snapshot, query, { fallback: 'cancelled', report });

    const set = await index.vectors();
    if (!set) return this.wordSource(snapshot, query, { fallback: 'not-indexed', report });
    if (this.loaded?.modelId !== index.modelId || this.loaded.generation !== this.generation) {
      const { paths, matrix } = set.toMatrix();
      await this.deps.search.load({ paths, dims: set.dims, matrix });
      this.loaded = { modelId: index.modelId, generation: this.generation };
    }
    if (!this.pruned) {
      this.pruned = true;
      await this.store.prune(2);
    }
    const exclude = query.exclude ?? [];
    return {
      method: 'embeddings',
      report,
      has: (path) => set.entries.has(path),
      neighbors: (path, k) => this.deps.search.similar(path, k, exclude),
    };
  }

  private async wordSource(snapshot: VaultSnapshot, query: NeighborSourceQuery, extra: Pick<NeighborSource, 'fallback' | 'error' | 'report'> = {}): Promise<PreparedSource> {
    const report = await this.words.update(snapshot.notes, (path) => this.deps.reader.read(path), {
      isCancelled: query.isCancelled,
      onProgress: ({ done, total }) => query.onProgress?.({ done, total, method: 'words' }),
    });
    const model = await this.words.model(new Set(snapshot.notes.map((note) => note.path)));
    const exclude = new Set(query.exclude ?? []);
    return {
      method: 'words',
      ...extra,
      report: extra.report ?? report,
      has: () => true,
      neighbors: (path, k) => Promise.resolve(model.similar(path, k, exclude)),
    };
  }

  private embeddingIndex(provider: EmbeddingProvider): EmbeddingIndex {
    const modelId = embeddingModelId(provider);
    let index = this.embeddings.get(modelId);
    if (!index) {
      index = new EmbeddingIndex(provider, this.store, this.deps.clock);
      this.embeddings.set(modelId, index);
    }
    return index;
  }
}

function isPrivate(snapshot: VaultSnapshot, path: string): boolean {
  const note = snapshot.notes.find((candidate) => candidate.path === path);
  return note !== undefined && isPrivateNote(note.frontmatter);
}
