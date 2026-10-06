import * as z from 'zod';
import type { Hasher, StoragePort } from '../ports';

/**
 * Bump when note preparation or chunking changes in a way that changes vectors; stored indexes with
 * another version are discarded instead of mixing old and new vectors.
 */
export const TEXT_VERSION = 1;

export interface StoredVector {
  contentHash: string;
  /** Unit-length note vector (length-weighted mean of its chunk vectors). */
  vector: Float32Array;
}

/**
 * The embedding vectors of one model, in memory: path → vector. A model's vectors are never mixed
 * with another's, because each `modelId` (provider endpoint + model name) has its own set.
 */
export class VectorSet {
  readonly entries = new Map<string, StoredVector>();

  constructor(
    readonly modelId: string,
    readonly dims: number,
  ) {}

  set(path: string, contentHash: string, vector: Float32Array): void {
    if (vector.length !== this.dims) throw new Error(`Expected ${this.dims} dimensions, got ${vector.length}.`);
    this.entries.set(path, { contentHash, vector });
  }

  /** Paths in a stable order and their vectors as one contiguous row-major matrix (for search). */
  toMatrix(): { paths: string[]; matrix: Float32Array } {
    const paths = [...this.entries.keys()].sort();
    const matrix = new Float32Array(paths.length * this.dims);
    paths.forEach((path, row) => {
      const entry = this.entries.get(path);
      if (entry) matrix.set(entry.vector, row * this.dims);
    });
    return { paths, matrix };
  }
}

const metaSchema = z.object({
  version: z.literal(1),
  textVersion: z.number().int(),
  modelId: z.string(),
  dims: z.number().int().positive(),
  rows: z.array(z.object({ path: z.string(), contentHash: z.string() })),
  /** SHA-256 of the vectors file, so a half-written or mismatched pair is detected. */
  vectorsSha256: z.string(),
  updatedAt: z.number(),
});

const ROOT = 'cache/index/embeddings';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Persists vector sets in the plugin's storage (PLAN §7.3): per model, a binary file of
 * little-endian float32 rows plus a JSON sidecar listing which note each row belongs to and the
 * content hash it was computed from. Anything that doesn't check out loads as "no index", which
 * costs a re-index but can never return wrong vectors.
 */
export class VectorStore {
  constructor(
    private readonly storage: StoragePort,
    private readonly hasher: Hasher,
  ) {}

  async load(modelId: string): Promise<VectorSet | null> {
    const folder = await this.folder(modelId);
    const [metaBytes, vectorBytes] = await Promise.all([this.storage.read(`${folder}/meta.json`), this.storage.read(`${folder}/vectors.f32`)]);
    if (!metaBytes || !vectorBytes) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(metaBytes));
    } catch {
      return null;
    }
    const meta = metaSchema.safeParse(raw);
    if (!meta.success || meta.data.modelId !== modelId || meta.data.textVersion !== TEXT_VERSION) return null;
    const { dims, rows } = meta.data;
    if (vectorBytes.byteLength !== rows.length * dims * 4) return null;
    if ((await this.hasher.sha256(vectorBytes)) !== meta.data.vectorsSha256) return null;

    const view = new DataView(vectorBytes.buffer, vectorBytes.byteOffset, vectorBytes.byteLength);
    const set = new VectorSet(modelId, dims);
    rows.forEach((row, index) => {
      const vector = new Float32Array(dims);
      for (let d = 0; d < dims; d++) vector[d] = view.getFloat32((index * dims + d) * 4, true);
      set.set(row.path, row.contentHash, vector);
    });
    return set;
  }

  async save(set: VectorSet, now: number): Promise<void> {
    const folder = await this.folder(set.modelId);
    const { paths, matrix } = set.toMatrix();
    const bytes = new Uint8Array(matrix.length * 4);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < matrix.length; i++) view.setFloat32(i * 4, matrix[i] ?? 0, true);
    const meta: z.infer<typeof metaSchema> = {
      version: 1,
      textVersion: TEXT_VERSION,
      modelId: set.modelId,
      dims: set.dims,
      rows: paths.map((path) => ({ path, contentHash: set.entries.get(path)?.contentHash ?? '' })),
      vectorsSha256: await this.hasher.sha256(bytes),
      updatedAt: now,
    };
    // Vectors first: if writing the sidecar fails, the checksum no longer matches and the pair is ignored.
    await this.storage.write(`${folder}/vectors.f32`, bytes);
    await this.storage.write(`${folder}/meta.json`, encoder.encode(JSON.stringify(meta)));
  }

  /** Removes the indexes of all but the `keep` most recently updated models (switching back is cheap for those). */
  async prune(keep: number): Promise<string[]> {
    const metas = (await this.storage.list(`${ROOT}/`)).filter((key) => key.endsWith('/meta.json'));
    const dated: { folder: string; updatedAt: number }[] = [];
    for (const key of metas) {
      const bytes = await this.storage.read(key);
      let updatedAt = 0;
      try {
        updatedAt = metaSchema.parse(JSON.parse(decoder.decode(bytes ?? new Uint8Array()))).updatedAt;
      } catch {
        // Unreadable sidecars are the first to go.
      }
      dated.push({ folder: key.slice(0, -'/meta.json'.length), updatedAt });
    }
    dated.sort((a, b) => b.updatedAt - a.updatedAt);
    const removed = dated.slice(keep).map((entry) => entry.folder);
    for (const folder of removed) {
      for (const key of await this.storage.list(`${folder}/`)) await this.storage.remove(key);
    }
    return removed;
  }

  /** One folder per model: a readable slug plus a hash, since model ids contain URLs and colons. */
  private async folder(modelId: string): Promise<string> {
    const model = modelId.split('|').at(-1) ?? modelId;
    const slug = model.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'model';
    const hash = (await this.hasher.sha256(modelId)).slice(0, 12);
    return `${ROOT}/${slug}-${hash}`;
  }
}

/** Identifies the vectors an embedding provider produces: same endpoint and model, same vectors. */
export function embeddingModelId(provider: { id: string; model: string }): string {
  return `${provider.id}|${provider.model}`;
}
