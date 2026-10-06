import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { silentLogger } from '../ports';
import { FakeEmbeddingProvider } from '../testing/fake-embeddings';
import { InMemoryVault } from '../testing/in-memory-vault';
import { MemoryStorage } from '../testing/memory-storage';
import { createSearchHandler, type DenseIndex } from './search';
import { type SearchBackend, SimilarityEngine, type SimilarityQuery } from './similarity';

/** In-process search backend that counts loads. */
class LocalSearch implements SearchBackend {
  loads = 0;
  private readonly handle = createSearchHandler();

  async load(index: DenseIndex): Promise<number> {
    this.loads++;
    const response = this.handle({ id: 1, type: 'load', paths: [...index.paths], dims: index.dims, matrix: index.matrix });
    return response.type === 'loaded' ? response.size : 0;
  }

  async similar(path: string, k: number, exclude: readonly string[] = []) {
    const response = this.handle({ id: 2, type: 'similar', path, k, exclude: [...exclude] });
    return response.type === 'result' ? response.neighbors : [];
  }
}

function setup() {
  const vault = InMemoryVault.from({
    'Garden/Tomatoes.md': 'Tomatoes need sun, compost and water in the raised bed.',
    'Garden/Beds.md': 'Raised beds with compost grow tomatoes and herbs.',
    'Sport/Marathon.md': 'Long runs and intervals build marathon endurance.',
    'Sport/Recovery.md': 'Easy runs between intervals help recovery after the marathon.',
    'Diary/Secret.md': '---\nai-vault-organizer: private\n---\nTomatoes and compost, but private.',
    'Templates/Daily.md': 'Tomatoes compost raised bed template.',
    'Vault Charter.md': 'Tomatoes go to Garden.',
  });
  const storage = new MemoryStorage();
  const search = new LocalSearch();
  const engine = new SimilarityEngine({ reader: vault, storage, hasher: webCryptoHasher, clock: { now: () => 1 }, search, logger: silentLogger });
  const query = (overrides: Partial<SimilarityQuery> = {}): SimilarityQuery => ({
    path: 'Garden/Tomatoes.md',
    k: 3,
    provider: null,
    ignore: ['Templates/**'],
    exclude: ['Vault Charter.md'],
    ...overrides,
  });
  return { vault, storage, search, engine, query };
}

describe('SimilarityEngine', () => {
  it('answers from word statistics without a provider, honouring ignore and exclude', async () => {
    const { engine, query } = setup();
    const result = await engine.similar(query());
    expect(result.method).toBe('words');
    expect(result.fallback).toBeUndefined();
    const paths = result.neighbors.map((n) => n.path);
    expect(paths[0]).toBe('Garden/Beds.md');
    expect(paths).not.toContain('Templates/Daily.md');
    expect(paths).not.toContain('Vault Charter.md');
  });

  it('answers by meaning with a provider and only embeds what changed', async () => {
    const { engine, query, vault, search } = setup();
    const provider = new FakeEmbeddingProvider();
    const first = await engine.similar(query({ provider }));
    expect(first.method).toBe('embeddings');
    expect(first.neighbors[0]?.path).toBe('Garden/Beds.md');
    expect(first.report?.indexed).toBe(5); // the private note and the ignored template are never sent
    expect(provider.calls.flat().some((text) => text.includes('private'))).toBe(false);
    expect(provider.calls.flat().some((text) => text.includes('template'))).toBe(false);

    const embedded = provider.embedded;
    await engine.similar(query({ provider, path: 'Sport/Marathon.md' }));
    expect(provider.embedded).toBe(embedded);
    expect(search.loads).toBe(1);

    vault.setFile('Sport/Recovery.md', 'Recovery now means tomatoes and compost.');
    const changed = await engine.similar(query({ provider }));
    expect(changed.report?.indexed).toBe(1);
    expect(search.loads).toBe(2);
  });

  it('keeps private notes away from the model and answers them from words', async () => {
    const { engine, query } = setup();
    const provider = new FakeEmbeddingProvider();
    const result = await engine.similar(query({ provider, path: 'Diary/Secret.md' }));
    expect(result).toMatchObject({ method: 'words', fallback: 'private' });
    expect(provider.calls).toEqual([]);
  });

  it('asks before sending notes to a cloud provider, and only when something is new', async () => {
    const { engine, query } = setup();
    const cloud = new FakeEmbeddingProvider('cloud-embed', 32, 'https://api.example.com/v1');
    const asked: number[] = [];
    const declined = await engine.similar(query({ provider: cloud, confirmSend: async ({ notes }) => (asked.push(notes), false) }));
    expect(declined).toMatchObject({ method: 'words', fallback: 'declined' });
    expect(cloud.calls).toEqual([]);

    const accepted = await engine.similar(query({ provider: cloud, confirmSend: async ({ notes }) => (asked.push(notes), true) }));
    expect(accepted.method).toBe('embeddings');
    await engine.similar(query({ provider: cloud, confirmSend: async ({ notes }) => (asked.push(notes), true) }));
    expect(asked).toEqual([5, 5]);
  });

  it('never asks for a local provider', async () => {
    const { engine, query } = setup();
    let asked = false;
    await engine.similar(query({ provider: new FakeEmbeddingProvider(), confirmSend: async () => (asked = true) }));
    expect(asked).toBe(false);
  });

  it('falls back to words when the provider fails or the run is cancelled', async () => {
    const { engine, query } = setup();
    const failing = new FakeEmbeddingProvider();
    failing.failOnCall = 1;
    expect(await engine.similar(query({ provider: failing }))).toMatchObject({ method: 'words', fallback: 'error', error: 'The embedding server is down.' });

    const cancelled = await engine.similar(query({ provider: new FakeEmbeddingProvider('other'), isCancelled: () => true }));
    expect(cancelled).toMatchObject({ method: 'words', fallback: 'cancelled' });
  });

  it('reports progress per method and forgets everything on clear', async () => {
    const { engine, query, storage } = setup();
    const methods = new Set<string>();
    await engine.similar(query({ provider: new FakeEmbeddingProvider(), onProgress: ({ method }) => methods.add(method) }));
    await engine.similar(query({ onProgress: ({ method }) => methods.add(method) }));
    expect([...methods].sort()).toEqual(['embeddings', 'words']);
    expect((await storage.list('cache/index/')).length).toBeGreaterThan(0);
    await engine.clear();
    expect(await storage.list('cache/index/')).toEqual([]);
  });
});
