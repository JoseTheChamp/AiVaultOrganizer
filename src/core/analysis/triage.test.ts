import { describe, expect, it } from 'vitest';
import { InMemoryVault } from '../testing/in-memory-vault';
import { suggestForStubs, triageNotes } from './triage';

async function notes(files: Record<string, string>) {
  return (await InMemoryVault.from(files).snapshot()).notes;
}

describe('triageNotes', () => {
  it('finds stubs, orphans and isolated notes, leaving daily notes alone', async () => {
    const triage = triageNotes(
      await notes({
        'Hub.md': 'The hub lists [[Plan]] and [[Idea]].',
        'Plan.md': 'A plan with enough words to be a real note, written over several sentences, and a link back to [[Hub]] for context.',
        'Idea.md': 'Maybe use felt panels?',
        'Lonely.md': 'Buy stamps',
        '2026-01-05.md': 'Short day.',
      }),
    );
    expect(triage.stubs).toEqual([
      { path: 'Idea.md', words: 4, inLinks: 1 },
      { path: 'Lonely.md', words: 2, inLinks: 0 },
    ]);
    expect(triage.orphans).toEqual(['Lonely.md']);
    expect(triage.isolated).toEqual(['Lonely.md']);
  });

  it('does not call a short note with outgoing links a stub', async () => {
    const triage = triageNotes(await notes({ 'Index.md': 'See [[A]] and [[B]].', 'A.md': 'x', 'B.md': 'y' }));
    expect(triage.stubs.map((s) => s.path)).toEqual(['A.md', 'B.md']);
  });
});

describe('suggestForStubs', () => {
  it('suggests merging into a close neighbour, otherwise the inbox', () => {
    const stubs = [
      { path: 'Idea.md', words: 4, inLinks: 1 },
      { path: 'Lonely.md', words: 2, inLinks: 0 },
    ];
    const nearest = (path: string) => (path === 'Idea.md' ? { path: 'Acoustic panels.md', score: 0.7 } : { path: 'Other.md', score: 0.1 });
    expect(suggestForStubs(stubs, nearest, 0.5)).toEqual([
      { path: 'Idea.md', words: 4, inLinks: 1, suggestion: { action: 'merge', target: 'Acoustic panels.md', score: 0.7 } },
      { path: 'Lonely.md', words: 2, inLinks: 0, suggestion: { action: 'inbox' } },
    ]);
  });
});
