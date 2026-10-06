import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { isPrivateNote } from '../model/privacy';
import { FakeEmbeddingProvider } from '../testing/fake-embeddings';
import { InMemoryVault } from '../testing/in-memory-vault';
import { MemoryStorage } from '../testing/memory-storage';
import { EmbeddingIndex, meanVector } from './embedding-index';
import { planIndexUpdate } from './indexing';
import { VectorStore } from './vector-store';
import { WordIndex } from './word-index';

const clock = { now: () => 1_000 };

function topicVault(): InMemoryVault {
  return InMemoryVault.from({
    'Garden/Tomatoes.md': 'Tomatoes need sun, compost and water in the raised bed.',
    'Garden/Beds.md': 'Raised beds with compost grow tomatoes and herbs.',
    'Sport/Marathon.md': 'Long runs and intervals build marathon endurance.',
    'Sport/Recovery.md': 'Easy runs between intervals help recovery after the marathon.',
    'Empty.md': '',
  });
}

describe('planIndexUpdate', () => {
  it('re-indexes new and changed notes only, and drops vanished ones', async () => {
    const snapshot = await topicVault().snapshot();
    const hashOf = (path: string): string => snapshot.notes.find((note) => note.path === path)?.contentHash ?? '';
    const stored = new Map([
      ['Garden/Tomatoes.md', hashOf('Garden/Tomatoes.md')],
      ['Garden/Beds.md', 'outdated'],
      ['Gone.md', 'whatever'],
    ]);
    const plan = planIndexUpdate(snapshot.notes, stored);
    expect(plan.stale.map((note) => note.path)).toEqual(['Empty.md', 'Garden/Beds.md', 'Sport/Marathon.md', 'Sport/Recovery.md']);
    expect(plan.unchanged).toBe(1);
    expect(plan.removed).toEqual(['Gone.md']);
  });
});

describe('isPrivateNote', () => {
  it('recognizes the private property in any casing, alone or in a list', () => {
    expect(isPrivateNote({ 'ai-vault-organizer': 'private' })).toBe(true);
    expect(isPrivateNote({ 'ai-vault-organizer': [' Private ', 'other'] })).toBe(true);
    expect(isPrivateNote({ 'ai-vault-organizer': 'public' })).toBe(false);
    expect(isPrivateNote({ private: true })).toBe(false);
  });
});

describe('WordIndex', () => {
  it('indexes once, then only what changed, and persists across instances', async () => {
    const vault = topicVault();
    const storage = new MemoryStorage();
    const reads: string[] = [];
    const read = (path: string): Promise<string> => {
      reads.push(path);
      return vault.read(path);
    };

    const first = await new WordIndex(storage).update((await vault.snapshot()).notes, read);
    expect(first).toMatchObject({ indexed: 5, unchanged: 0, removed: 0, remaining: 0, cancelled: false });
    const model = await new WordIndex(storage).model();
    expect(model.similar('Garden/Tomatoes.md', 1)[0]?.path).toBe('Garden/Beds.md');

    reads.length = 0;
    const index = new WordIndex(storage);
    expect(await index.update((await vault.snapshot()).notes, read)).toMatchObject({ indexed: 0, unchanged: 5 });
    expect(reads).toEqual([]);

    vault.setFile('Sport/Recovery.md', 'Now this note is about tomatoes and compost.');
    await vault.move('Empty.md', 'Moved.md');
    const third = await index.update((await vault.snapshot()).notes, read);
    expect(third).toMatchObject({ indexed: 2, unchanged: 3, removed: 1 });
    expect(reads.sort()).toEqual(['Moved.md', 'Sport/Recovery.md']);
    expect((await index.model()).similar('Sport/Recovery.md', 2).map((n) => n.path)).toContain('Garden/Tomatoes.md');
  });

  it('stops when cancelled and reports what is left', async () => {
    const vault = topicVault();
    let checks = 0;
    const report = await new WordIndex(new MemoryStorage()).update((await vault.snapshot()).notes, (path) => vault.read(path), {
      isCancelled: () => ++checks > 2,
    });
    expect(report).toMatchObject({ indexed: 2, remaining: 3, cancelled: true });
  });

  it('rebuilds from the notes when the cache is damaged', async () => {
    const vault = topicVault();
    const storage = new MemoryStorage();
    await storage.write('cache/index/words.json.gz', new TextEncoder().encode('not gzip'));
    const report = await new WordIndex(storage).update((await vault.snapshot()).notes, (path) => vault.read(path));
    expect(report.indexed).toBe(5);
  });
});

describe('EmbeddingIndex', () => {
  async function setup(provider = new FakeEmbeddingProvider()) {
    const vault = topicVault();
    const storage = new MemoryStorage();
    const store = new VectorStore(storage, webCryptoHasher);
    const index = new EmbeddingIndex(provider, store, clock);
    return { vault, storage, store, index, provider, read: (path: string) => vault.read(path) };
  }

  it('embeds in batches of whole notes, then only what changed', async () => {
    const { vault, index, provider, read, store } = await setup();
    const progress: number[] = [];
    const report = await index.update((await vault.snapshot()).notes, read, { batchSize: 2, onProgress: ({ done }) => progress.push(done) });
    expect(report).toMatchObject({ indexed: 5, unchanged: 0, remaining: 0 });
    expect(report.tokens).toBeGreaterThan(0);
    expect(provider.calls.map((call) => call.length)).toEqual([2, 2, 1]);
    expect(progress).toEqual([2, 4, 5]);

    const vectors = await index.vectors();
    expect(vectors?.entries.size).toBe(5);
    for (const { vector } of vectors?.entries.values() ?? []) {
      expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
    }

    vault.setFile('Garden/Beds.md', 'Beds are now about intervals.');
    const again = await new EmbeddingIndex(provider, store, clock).update((await vault.snapshot()).notes, read);
    expect(again).toMatchObject({ indexed: 1, unchanged: 4 });
    expect(provider.calls.at(-1)?.[0]).toContain('Beds are now about intervals.');
  });

  it('keeps finished notes when the provider fails and resumes from there', async () => {
    const { vault, index, provider, read, store } = await setup();
    provider.failOnCall = 2;
    await expect(index.update((await vault.snapshot()).notes, read, { batchSize: 2 })).rejects.toThrow(/down/);
    expect((await store.load(index.modelId))?.entries.size).toBe(2);

    provider.failOnCall = null;
    const resumed = await new EmbeddingIndex(provider, store, clock).update((await vault.snapshot()).notes, read, { batchSize: 2 });
    expect(resumed).toMatchObject({ indexed: 3, unchanged: 2 });
  });

  it('saves progress when cancelled', async () => {
    const { vault, index, read, store } = await setup();
    let batches = 0;
    const report = await index.update((await vault.snapshot()).notes, read, { batchSize: 2, isCancelled: () => ++batches > 1 });
    expect(report).toMatchObject({ indexed: 2, remaining: 3, cancelled: true });
    expect((await store.load(index.modelId))?.entries.size).toBe(2);
  });

  it('keeps a separate index per model', async () => {
    const { vault, read, store } = await setup();
    await new EmbeddingIndex(new FakeEmbeddingProvider('model-a'), store, clock).update((await vault.snapshot()).notes, read);
    const other = new FakeEmbeddingProvider('model-b', 8);
    const report = await new EmbeddingIndex(other, store, clock).update((await vault.snapshot()).notes, read);
    expect(report.indexed).toBe(5);
    expect((await store.load(new EmbeddingIndex(other, store, clock).modelId))?.dims).toBe(8);
  });
});

describe('meanVector', () => {
  it('weights chunks by length and normalizes', () => {
    const vectors = [Float32Array.from([1, 0]), Float32Array.from([0, 1])];
    const mean = meanVector(vectors, [
      { text: '', tokens: 3, heading: null },
      { text: '', tokens: 1, heading: null },
    ]);
    expect(mean[0]).toBeCloseTo(3 / Math.hypot(3, 1), 6);
    expect(mean[1]).toBeCloseTo(1 / Math.hypot(3, 1), 6);
    expect(() => meanVector([], [])).toThrow();
  });
});
