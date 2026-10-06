import type { EmbeddingProvider } from '../ai/types';
import type { NoteRecord } from '../model/note';
import type { Clock } from '../ports';
import { type Chunk, chunkNote, DEFAULT_CHUNK_OPTIONS } from './chunk';
import { type IndexOptions, type IndexReport, planIndexUpdate } from './indexing';
import { prepareNote } from './prepare';
import { embeddingModelId, VectorSet, type VectorStore } from './vector-store';

export interface EmbeddingIndexOptions extends IndexOptions {
  /** Chunks sent per request; notes are never split across requests. */
  batchSize?: number;
  /** Progress is saved after this many notes, so a cancelled or failed run keeps most of its work. */
  checkpointEvery?: number;
}

/**
 * Keeps an embedding index current (PLAN §7.3): loads the stored vectors for the provider's model,
 * embeds only new and changed notes in batches, and saves at checkpoints. A note's vector is the
 * length-weighted mean of its chunk vectors, normalized to unit length, so cosine similarity is a
 * plain dot product.
 */
export class EmbeddingIndex {
  private set: VectorSet | null = null;

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly store: VectorStore,
    private readonly clock: Clock,
  ) {}

  get modelId(): string {
    return embeddingModelId(this.provider);
  }

  /** The vectors after the last `update` (or as stored), or null before anything was embedded. */
  async vectors(): Promise<VectorSet | null> {
    this.set ??= await this.store.load(this.modelId);
    return this.set;
  }

  async update(notes: readonly NoteRecord[], read: (path: string) => Promise<string>, options: EmbeddingIndexOptions = {}): Promise<IndexReport> {
    const batchSize = options.batchSize ?? 16;
    const checkpointEvery = options.checkpointEvery ?? 50;
    let set = await this.vectors();
    const stored = new Map<string, string>();
    for (const [path, entry] of set?.entries ?? []) stored.set(path, entry.contentHash);
    const plan = planIndexUpdate(notes, stored);
    for (const path of plan.removed) set?.entries.delete(path);

    let indexed = 0;
    let tokens = 0;
    let sinceSave = plan.removed.length > 0 ? 1 : 0;
    let cancelled = false;
    const save = async (): Promise<void> => {
      if (set && sinceSave > 0) await this.store.save(set, this.clock.now());
      sinceSave = 0;
    };

    try {
      let next = 0;
      let carried: { note: NoteRecord; chunks: Chunk[] } | null = null;
      while (carried || next < plan.stale.length) {
        if (options.isCancelled?.()) {
          cancelled = true;
          break;
        }
        // Gather whole notes until the batch is full (a single long note may exceed it on its own).
        const batch: { note: NoteRecord; chunks: Chunk[] }[] = [];
        let size = 0;
        while (carried || next < plan.stale.length) {
          let item: { note: NoteRecord; chunks: Chunk[] } | null = carried;
          carried = null;
          if (!item) {
            const note = plan.stale[next++] as NoteRecord;
            item = { note, chunks: chunkNote(prepareNote(await read(note.path), note.basename), DEFAULT_CHUNK_OPTIONS) };
          }
          if (batch.length > 0 && size + item.chunks.length > batchSize) {
            carried = item;
            break;
          }
          batch.push(item);
          size += item.chunks.length;
          if (size >= batchSize) break;
        }

        const response = await this.provider.embed(batch.flatMap((item) => item.chunks.map((chunk) => chunk.text)));
        tokens += response.usage.inputTokens;
        let offset = 0;
        for (const { note, chunks } of batch) {
          const vector = meanVector(response.vectors.slice(offset, offset + chunks.length), chunks);
          offset += chunks.length;
          if (!set || set.dims !== vector.length) set = new VectorSet(this.modelId, vector.length);
          set.set(note.path, note.contentHash, vector);
          indexed++;
          sinceSave++;
        }
        this.set = set;
        options.onProgress?.({ done: indexed, total: plan.stale.length });
        if (sinceSave >= checkpointEvery) await save();
      }
    } finally {
      // Runs on success, cancellation and provider errors alike: finished notes are never lost.
      this.set = set;
      await save();
    }
    return { indexed, unchanged: plan.unchanged, removed: plan.removed.length, remaining: plan.stale.length - indexed, cancelled, tokens };
  }
}

/** Length-weighted mean of chunk vectors, scaled to unit length. */
export function meanVector(vectors: readonly Float32Array[], chunks: readonly Chunk[]): Float32Array {
  const first = vectors[0];
  if (!first) throw new Error('No vectors to average.');
  const mean = new Float32Array(first.length);
  vectors.forEach((vector, i) => {
    if (vector.length !== mean.length) throw new Error('Chunk vectors differ in size.');
    const weight = Math.max(1, chunks[i]?.tokens ?? 1);
    for (let d = 0; d < mean.length; d++) mean[d] = (mean[d] ?? 0) + (vector[d] ?? 0) * weight;
  });
  let norm = 0;
  for (const value of mean) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let d = 0; d < mean.length; d++) mean[d] = (mean[d] ?? 0) / norm;
  return mean;
}
