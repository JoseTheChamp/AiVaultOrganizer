/**
 * Semantic index against a real embedding model on the 600-note topic vault: the M5 definition of
 * done. Live only, because 600 recorded vectors would be megabytes of cassette; the logic itself is
 * covered offline by the unit tests with a fake provider.
 *
 *   LIVE=1 npx vitest run eval/similarity.smoke.test.ts                                   bge-m3 on localhost
 *   LIVE=1 OLLAMA_EMBED_MODEL=nomic-embed-text npx vitest run eval/similarity.smoke.test.ts
 *
 * Last run (bge-m3, Ollama 0.35, 2026-10-06): first index 29 s (20 s of it loading the model),
 * unchanged re-index 11 ms, precision@5 0.999, Czech→English precision@5 1.0 (word statistics: 0.51).
 */
import { describe, expect, it } from 'vitest';
import { createEmbeddingProvider } from '../src/core/ai/factory';
import { aiSettingsSchema } from '../src/core/ai/settings';
import { EmbeddingIndex } from '../src/core/embeddings/embedding-index';
import { DenseSearch } from '../src/core/embeddings/search';
import { VectorStore } from '../src/core/embeddings/vector-store';
import { webCryptoHasher } from '../src/core/hash';
import { systemClock } from '../src/core/ports';
import { FakeSecrets } from '../src/core/testing/fake-http';
import { InMemoryVault } from '../src/core/testing/in-memory-vault';
import { MemoryStorage } from '../src/core/testing/memory-storage';
import { FetchHttp } from './adapters/fetch-http';
import { generateTopicVault } from './generator/topic-vault';
import { neighborQuality } from './metrics/neighbors';

const live = process.env.LIVE === '1';
const model = process.env.OLLAMA_EMBED_MODEL ?? 'bge-m3';

describe.runIf(live)(`semantic index on the 600-note topic vault (${model})`, { timeout: 900_000 }, () => {
  it('indexes, re-indexes incrementally and finds same-topic notes across languages', async () => {
    const generated = generateTopicVault({ notes: 600 });
    const vault = InMemoryVault.from(generated.files);
    const storage = new MemoryStorage();
    const settings = aiSettingsSchema.parse({ embeddings: { enabled: true, model } });
    const provider = createEmbeddingProvider(settings, {
      http: new FetchHttp(),
      secrets: new FakeSecrets(),
      storage,
      hasher: webCryptoHasher,
      clock: systemClock,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });
    if (!provider) throw new Error('No embedding provider; check the settings.');
    const store = new VectorStore(storage, webCryptoHasher);
    const read = (path: string): Promise<string> => vault.read(path);

    let started = Date.now();
    const first = await new EmbeddingIndex(provider, store, systemClock).update((await vault.snapshot()).notes, read);
    const firstMs = Date.now() - started;
    expect(first).toMatchObject({ indexed: 600, remaining: 0 });

    // A fresh instance reads the stored index: nothing to embed.
    started = Date.now();
    const again = await new EmbeddingIndex(provider, store, systemClock).update((await vault.snapshot()).notes, read);
    const againMs = Date.now() - started;
    expect(again).toMatchObject({ indexed: 0, unchanged: 600 });

    const [a, b, c] = Object.keys(generated.files);
    for (const path of [a, b, c]) if (path) vault.setFile(path, `${generated.files[path] ?? ''}\nEdited.\n`);
    const index = new EmbeddingIndex(provider, store, systemClock);
    expect(await index.update((await vault.snapshot()).notes, read)).toMatchObject({ indexed: 3, unchanged: 597 });

    const set = await index.vectors();
    if (!set) throw new Error('No vectors stored.');
    const { paths, matrix } = set.toMatrix();
    const search = new DenseSearch({ paths, dims: set.dims, matrix });
    const all = new Map(paths.map((path) => [path, search.similar(path, 5).map((n) => n.path)]));
    const czech = paths.filter((path) => generated.languages[path] === 'cs');
    const czechSet = new Set(czech);
    const cross = new Map(czech.map((path) => [path, search.similar(path, 5, czechSet).map((n) => n.path)]));
    const overall = neighborQuality(all, generated.topics, generated.languages, 5);
    const crossLanguage = neighborQuality(cross, generated.topics, generated.languages, 5);

    process.stdout.write(
      `${model}: ${set.dims} dims, first index ${firstMs} ms (${first.tokens} tokens), unchanged re-index ${againMs} ms, ` +
        `precision@5 ${overall.precision.toFixed(3)}, Czech→English precision@5 ${crossLanguage.precision.toFixed(3)}\n`,
    );
    expect(overall.precision).toBeGreaterThan(0.9);
    // Word statistics reach about 0.5 here (eval/integration/similarity.test.ts).
    expect(crossLanguage.precision).toBeGreaterThan(0.8);
  });
});
