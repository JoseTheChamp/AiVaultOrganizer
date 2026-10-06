import { describe, expect, it } from 'vitest';
import { neighborQuality } from '../metrics/neighbors';
import { generateTopicVault } from './topic-vault';
import { TOPICS } from './topics';

describe('generateTopicVault', () => {
  it('is deterministic for a seed and different across seeds', () => {
    expect(generateTopicVault({ notes: 50, seed: 7 })).toEqual(generateTopicVault({ notes: 50, seed: 7 }));
    expect(generateTopicVault({ notes: 50, seed: 7 }).files).not.toEqual(generateTopicVault({ notes: 50, seed: 8 }).files);
  });

  it('produces the requested number of notes, balanced over topics, with ground truth', () => {
    const vault = generateTopicVault({ notes: 600 });
    const paths = Object.keys(vault.files);
    expect(paths).toHaveLength(600);
    expect(Object.keys(vault.topics).sort()).toEqual([...paths].sort());
    const perTopic = new Map<string, number>();
    for (const topic of Object.values(vault.topics)) perTopic.set(topic, (perTopic.get(topic) ?? 0) + 1);
    expect([...perTopic.values()]).toEqual(TOPICS.map(() => 60));
    const czech = Object.values(vault.languages).filter((language) => language === 'cs').length;
    expect(czech / 600).toBeGreaterThan(0.2);
    expect(czech / 600).toBeLessThan(0.4);
  });

  it('uses file names that are valid on every system and in Obsidian links', () => {
    for (const path of Object.keys(generateTopicVault({ notes: 600 }).files)) {
      expect(path.split('/').at(-1)).not.toMatch(/[\\:*?"<>|#^[\]]/);
    }
  });

  it('writes notes from the topic material of their language', () => {
    const vault = generateTopicVault({ notes: 40 });
    for (const [path, content] of Object.entries(vault.files)) {
      const topic = TOPICS.find((candidate) => candidate.id === vault.topics[path]);
      const material = topic?.[vault.languages[path] ?? 'en'];
      expect(material?.sentences.some((sentence) => content.includes(sentence))).toBe(true);
    }
  });
});

describe('neighborQuality', () => {
  it('measures topic precision and cross-language hits at k', () => {
    const topics = { a: 'x', b: 'x', c: 'y', d: 'x' };
    const languages = { a: 'en', b: 'cs', c: 'en', d: 'en' };
    const neighbors = new Map([
      ['a', ['b', 'c', 'd']],
      ['c', ['a', 'b']],
      ['d', []],
    ]);
    expect(neighborQuality(neighbors, topics, languages, 2)).toEqual({ notes: 2, k: 2, precision: 0.25, crossLanguage: 0.25 });
  });
});
