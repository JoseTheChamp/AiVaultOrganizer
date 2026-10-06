import { describe, expect, it } from 'vitest';
import { terms, tokens } from '../embeddings/tfidf';
import { clusterKeywords } from './keywords';

describe('tokens', () => {
  it('pairs each index term with the word as written', () => {
    expect(tokens('Zahrada a zahrady, Gardening!')).toEqual([
      { term: 'zahrad', word: 'zahrada' },
      { term: 'zahrad', word: 'zahrady' },
      { term: 'garden', word: 'gardening' },
    ]);
    expect(terms('Zahrada a zahrady, Gardening!')).toEqual(['zahrad', 'zahrad', 'garden']);
  });
});

describe('clusterKeywords', () => {
  const texts = new Map([
    ['g1', 'Tomatoes need compost. The raised bed gets compost and water.'],
    ['g2', 'Compost the raised bed before planting tomatoes. Water in the morning.'],
    ['g3', 'Prune the apple tree; water the tomatoes.'],
    ['r1', 'Intervals build speed. Water bottle for the long run.'],
    ['r2', 'The long run on Sunday, then intervals on Tuesday. Drink water.'],
    ['r3', 'Long intervals and easy runs.'],
    ['c1', 'Zahrádka u chaty: rajčata a bylinky.'],
    ['c2', 'Rajčata potřebují zahrádku a vodu.'],
  ]);
  const clusters = [
    { id: 0, members: ['g1', 'g2', 'g3'] },
    { id: 1, members: ['r1', 'r2', 'r3'] },
    { id: 2, members: ['c1', 'c2'] },
  ];

  it('ranks words concentrated in a cluster above words common to all', () => {
    const [garden, running] = clusterKeywords(clusters, texts, { top: 3, minNotes: 2 });
    // "bed" and "raised" tie; ties go alphabetically by term.
    expect(garden?.keywords).toEqual(['compost', 'tomatoes', 'bed']);
    expect(running?.keywords.slice(0, 2)).toEqual(['intervals', 'long']);
    // "water" appears in both clusters, so it ranks below their own words.
    expect(garden?.keywords).not.toContain('water');
  });

  it('shows the commonest form of a word, with its diacritics', () => {
    const czech = clusterKeywords(clusters, texts, { top: 2, minNotes: 2 })[2];
    expect(czech?.keywords).toEqual(['rajčata', 'zahrádka']);
  });

  it('requires a keyword to appear in several notes of a larger cluster', () => {
    const [garden] = clusterKeywords(clusters, texts, { top: 10, minNotes: 2 });
    expect(garden?.keywords).not.toContain('apple');
    expect(clusterKeywords(clusters, texts, { top: 10, minNotes: 1 })[0]?.keywords).toContain('apple');
  });
});
