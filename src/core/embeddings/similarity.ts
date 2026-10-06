import { ProviderError, type EmbeddingProvider } from '../ai/types';
import type { VaultSnapshot } from '../model/note';
import { isPrivateNote } from '../model/privacy';
import type { Clock, Hasher, Logger, StoragePort, VaultReader } from '../ports';
import { EmbeddingIndex } from './embedding-index';
import { type IndexReport, planIndexUpdate } from './indexing';
import type { DenseIndex } from './search';
import type { Neighbor } from './top-k';
import { embeddingModelId, VectorStore } from './vector-store';
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
    if (query.provider) {
      const target = snapshot.notes.find((note) => note.path === query.path);
      if (target && isPrivateNote(target.frontmatter)) return this.byWords(snapshot, query, { fallback: 'private' });
      return this.byEmbeddings(snapshot, query, query.provider);
    }
    return this.byWords(snapshot, query);
  }

  /** Forgets every index; the next search rebuilds what it needs. */
  async clear(): Promise<void> {
    for (const key of await this.deps.storage.list('cache/index/')) await this.deps.storage.remove(key);
    this.words = new WordIndex(this.deps.storage);
    this.embeddings.clear();
    this.loaded = null;
  }

  private async byEmbeddings(snapshot: VaultSnapshot, query: SimilarityQuery, provider: EmbeddingProvider): Promise<SimilarityResult> {
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
      if (!(await query.confirmSend(estimate))) return this.byWords(snapshot, query, { fallback: 'declined' });
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
      return this.byWords(snapshot, query, { fallback: 'error', error: error.message });
    }
    if (report.indexed > 0 || report.removed > 0) this.generation++;
    if (report.cancelled) return this.byWords(snapshot, query, { fallback: 'cancelled', report });

    const set = await index.vectors();
    if (!set?.entries.has(query.path)) return this.byWords(snapshot, query, { fallback: 'not-indexed', report });
    if (this.loaded?.modelId !== index.modelId || this.loaded.generation !== this.generation) {
      const { paths, matrix } = set.toMatrix();
      await this.deps.search.load({ paths, dims: set.dims, matrix });
      this.loaded = { modelId: index.modelId, generation: this.generation };
    }
    if (!this.pruned) {
      this.pruned = true;
      await this.store.prune(2);
    }
    const neighbors = await this.deps.search.similar(query.path, query.k, query.exclude ?? []);
    return { method: 'embeddings', neighbors, report };
  }

  private async byWords(snapshot: VaultSnapshot, query: SimilarityQuery, extra: Partial<SimilarityResult> = {}): Promise<SimilarityResult> {
    const report = await this.words.update(snapshot.notes, (path) => this.deps.reader.read(path), {
      isCancelled: query.isCancelled,
      onProgress: ({ done, total }) => query.onProgress?.({ done, total, method: 'words' }),
    });
    const model = await this.words.model(new Set(snapshot.notes.map((note) => note.path)));
    const neighbors = model.similar(query.path, query.k, new Set(query.exclude ?? []));
    return { method: 'words', neighbors, ...extra, report: extra.report ?? report };
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
