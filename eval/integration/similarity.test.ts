import { describe, expect, it } from 'vitest';
import { prepareNote } from '../../src/core/embeddings/prepare';
import { countTerms, TfidfModel } from '../../src/core/embeddings/tfidf';
import { parseNote } from '../../src/core/markdown/parse-note';
import { generateTopicVault } from '../generator/topic-vault';
import { neighborQuality } from '../metrics/neighbors';

/**
 * Tier 0 similarity on the synthetic 600-note topic vault. Notes of one topic share sentences, so
 * word statistics should find same-topic neighbours almost perfectly; across languages they share
 * no words, so retrieval from Czech notes into English ones should fail. That gap is what
 * embeddings close (see the Ollama smoke test). M6 turns these into reported eval metrics.
 */
describe('word similarity on the topic vault', () => {
  const vault = generateTopicVault({ notes: 600 });
  const documents = new Map(
    Object.entries(vault.files).map(([path, content]) => {
      const title = path.split('/').at(-1)?.replace(/\.md$/, '') ?? path;
      return [path, countTerms(prepareNote(content, title), parseNote(content).tags)];
    }),
  );
  const model = TfidfModel.build(documents);

  it('finds same-topic neighbours for every note', () => {
    const neighbors = new Map(Object.keys(vault.files).map((path) => [path, model.similar(path, 5).map((n) => n.path)]));
    const quality = neighborQuality(neighbors, vault.topics, vault.languages, 5);
    expect(quality.answered).toBe(600);
    expect(quality.precision).toBeGreaterThan(0.95);
  });

  it('matches Czech notes to English ones on the same topic only through shared names', () => {
    const czech = Object.keys(vault.files).filter((path) => vault.languages[path] === 'cs');
    const neighbors = new Map(czech.map((path) => [path, model.similar(path, 5, new Set(czech)).map((n) => n.path)]));
    const quality = neighborQuality(neighbors, vault.topics, vault.languages, 5);
    // Only shared names (TypeScript, JSON, a "finance" tag) connect the languages at all.
    expect(quality.precision).toBeLessThan(0.6);
  });
});
