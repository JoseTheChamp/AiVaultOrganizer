import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../ai/budget';
import { chunkNote, DEFAULT_CHUNK_OPTIONS } from './chunk';
import { prepareNote } from './prepare';

const sentence = (i: number): string => `Sentence number ${i} talks about tomatoes, soil and water in some detail.`;

describe('chunkNote', () => {
  it('puts a short note in one chunk that starts with the title', () => {
    const chunks = chunkNote(prepareNote('# Beds\nRaised beds.\n# Herbs\nBasil.', 'Garden'));
    expect(chunks).toEqual([{ text: 'Garden\nBeds\nRaised beds.\nHerbs\nBasil.', tokens: expect.any(Number) as number, heading: 'Beds' }]);
  });

  it('returns the title alone for an empty note', () => {
    expect(chunkNote(prepareNote('', 'Empty'))).toEqual([{ text: 'Empty', tokens: 2, heading: null }]);
  });

  it('keeps every chunk under the limit and splits long sections with overlap', () => {
    const body = `# Growing\n${Array.from({ length: 80 }, (_, i) => sentence(i)).join(' ')}\n# Cooking\nSoup.`;
    const options = { ...DEFAULT_CHUNK_OPTIONS, maxTokens: 120, overlapTokens: 20 };
    const chunks = chunkNote(prepareNote(body, 'Tomatoes'), options);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(options.maxTokens);
      expect(chunk.tokens).toBe(estimateTokens(chunk.text));
      expect(chunk.text.startsWith('Tomatoes\n')).toBe(true);
    }
    // Continuation chunks repeat the heading trail and the end of the previous chunk.
    const [firstChunk, second] = chunks;
    expect(second?.text.split('\n')[1]).toBe('Growing');
    const lastWords = firstChunk?.text.split(/\s+/).slice(-3).join(' ') ?? '';
    expect(second?.text).toContain(lastWords);
    // A small section that fits joins the chunk before it.
    expect(chunks.at(-1)?.text.endsWith('\nCooking\nSoup.')).toBe(true);
  });

  it('never ends a chunk with a heading and never overlaps across sections', () => {
    const long = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ');
    const body = `# A\n${long}\n# B\n${long}`;
    const chunks = chunkNote(prepareNote(body, 'T'), { ...DEFAULT_CHUNK_OPTIONS, maxTokens: 200 });
    for (const chunk of chunks) expect(['A', 'B']).not.toContain(chunk.text.split('\n').at(-1));
    // Section B starts fresh: its heading, then its own first sentence, with no overlap from A.
    const startOfB = chunks.find((chunk) => chunk.text.startsWith('T\nB\n'));
    expect(startOfB?.text).toMatch(/^T\nB\nSentence number 0 /);
  });

  it('keeps the parent headings when a chunk starts at a sub-heading', () => {
    const long = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkNote(prepareNote(`# Garden\n${long}\n## Herbs\nBasil and thyme.`, 'Notes'), { ...DEFAULT_CHUNK_OPTIONS, maxTokens: 200 });
    const herbs = chunks.find((chunk) => chunk.heading === 'Garden > Herbs');
    expect(herbs?.text).toBe('Notes\nGarden > Herbs\nBasil and thyme.');
  });

  it('splits long lists by lines and enormous words by characters', () => {
    const list = Array.from({ length: 60 }, (_, i) => `- item ${i} with a few words`).join('\n');
    const options = { ...DEFAULT_CHUNK_OPTIONS, maxTokens: 80 };
    for (const chunk of chunkNote(prepareNote(list, 'List'), options)) expect(chunk.tokens).toBeLessThanOrEqual(80);
    for (const chunk of chunkNote(prepareNote('x'.repeat(5000), 'Blob'), options)) expect(chunk.tokens).toBeLessThanOrEqual(80);
  });

  it('caps the number of chunks for very long notes', () => {
    const body = Array.from({ length: 2000 }, (_, i) => sentence(i)).join('\n\n');
    expect(chunkNote(prepareNote(body, 'Book'), { ...DEFAULT_CHUNK_OPTIONS, maxChunks: 5 })).toHaveLength(5);
  });

  it('is deterministic', () => {
    const body = Array.from({ length: 50 }, (_, i) => sentence(i)).join('\n\n');
    expect(chunkNote(prepareNote(body, 'Same'))).toEqual(chunkNote(prepareNote(body, 'Same')));
  });
});
