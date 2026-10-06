import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { MemoryStorage } from '../testing/memory-storage';
import { embeddingModelId, VectorSet, VectorStore } from './vector-store';

const MODEL = embeddingModelId({ id: 'openai-compatible:http://localhost:11434/v1', model: 'bge-m3' });

function sampleSet(modelId = MODEL): VectorSet {
  const set = new VectorSet(modelId, 3);
  set.set('b.md', 'hash-b', Float32Array.from([0, 1, 0]));
  set.set('a.md', 'hash-a', Float32Array.from([0.6, 0, 0.8]));
  return set;
}

describe('VectorSet', () => {
  it('rejects vectors of the wrong size and builds a sorted matrix', () => {
    const set = sampleSet();
    expect(() => set.set('c.md', 'h', new Float32Array(2))).toThrow(/3 dimensions/);
    const { paths, matrix } = set.toMatrix();
    expect(paths).toEqual(['a.md', 'b.md']);
    expect([...matrix].map((x) => Math.round(x * 10) / 10)).toEqual([0.6, 0, 0.8, 0, 1, 0]);
  });
});

describe('VectorStore', () => {
  it('round-trips a set exactly through little-endian float32 files', async () => {
    const storage = new MemoryStorage();
    const store = new VectorStore(storage, webCryptoHasher);
    await store.save(sampleSet(), 1000);
    const keys = [...storage.entries.keys()].sort();
    expect(keys).toEqual([expect.stringMatching(/^cache\/index\/embeddings\/bge-m3-[0-9a-f]{12}\/meta\.json$/), expect.stringMatching(/vectors\.f32$/)]);
    const vectors = storage.entries.get(keys[1] ?? '');
    expect(vectors?.byteLength).toBe(24);
    expect(new DataView((vectors ?? new Uint8Array()).buffer).getFloat32(0, true)).toBeCloseTo(0.6, 6);

    const loaded = await store.load(MODEL);
    expect(loaded?.dims).toBe(3);
    expect(loaded?.entries.get('a.md')).toEqual({ contentHash: 'hash-a', vector: Float32Array.from([0.6, 0, 0.8]) });
    expect(loaded?.entries.get('b.md')?.contentHash).toBe('hash-b');
  });

  it('keeps models apart', async () => {
    const store = new VectorStore(new MemoryStorage(), webCryptoHasher);
    await store.save(sampleSet(), 1000);
    expect(await store.load(embeddingModelId({ id: 'openai-compatible:https://api.openai.com/v1', model: 'bge-m3' }))).toBeNull();
    expect(await store.load(embeddingModelId({ id: 'openai-compatible:http://localhost:11434/v1', model: 'nomic-embed-text' }))).toBeNull();
  });

  it('treats a corrupt, truncated or mismatched index as missing', async () => {
    const storage = new MemoryStorage();
    const store = new VectorStore(storage, webCryptoHasher);
    await store.save(sampleSet(), 1000);
    const vectorsKey = [...storage.entries.keys()].find((key) => key.endsWith('vectors.f32')) ?? '';
    const metaKey = vectorsKey.replace('vectors.f32', 'meta.json');
    const original = storage.entries.get(vectorsKey) ?? new Uint8Array();

    storage.entries.set(vectorsKey, original.slice(0, 12));
    expect(await store.load(MODEL)).toBeNull();

    const flipped = original.slice();
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    storage.entries.set(vectorsKey, flipped);
    expect(await store.load(MODEL)).toBeNull();

    storage.entries.set(vectorsKey, original);
    storage.entries.set(metaKey, new TextEncoder().encode('{not json'));
    expect(await store.load(MODEL)).toBeNull();
  });

  it('discards indexes built with another text preparation version', async () => {
    const storage = new MemoryStorage();
    const store = new VectorStore(storage, webCryptoHasher);
    await store.save(sampleSet(), 1000);
    const metaKey = [...storage.entries.keys()].find((key) => key.endsWith('meta.json')) ?? '';
    const meta = JSON.parse(storage.text(metaKey) ?? '{}') as Record<string, unknown>;
    storage.entries.set(metaKey, new TextEncoder().encode(JSON.stringify({ ...meta, textVersion: 0 })));
    expect(await store.load(MODEL)).toBeNull();
  });

  it('prunes all but the most recently updated models', async () => {
    const storage = new MemoryStorage();
    const store = new VectorStore(storage, webCryptoHasher);
    await store.save(sampleSet('p|old'), 1);
    await store.save(sampleSet('p|newest'), 3);
    await store.save(sampleSet('p|middle'), 2);
    const removed = await store.prune(2);
    expect(removed).toEqual([expect.stringMatching(/\/old-/)]);
    expect(await store.load('p|old')).toBeNull();
    expect(await store.load('p|newest')).not.toBeNull();
    expect(await store.load('p|middle')).not.toBeNull();
  });
});
