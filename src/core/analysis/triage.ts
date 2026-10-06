import type { Neighbor } from '../embeddings/top-k';
import type { NoteRecord } from '../model/note';
import { DATED_NAME } from './stats';

export interface TriageOptions {
  /** A note with fewer words than this and no outgoing links is a stub. */
  stubWords: number;
}

// Two short sentences are a note; a title and a fragment are a stub.
export const DEFAULT_TRIAGE: TriageOptions = { stubWords: 10 };

export interface StubSuggestion {
  /** Merge into a close neighbour, or process it from the inbox when nothing is close. */
  action: 'merge' | 'inbox';
  target?: string;
  score?: number;
}

export interface Stub {
  path: string;
  words: number;
  /** Notes that link to the stub; merging must keep them pointing somewhere. */
  inLinks: number;
  suggestion?: StubSuggestion;
}

export interface Triage {
  stubs: Stub[];
  /** Nothing links to them (daily notes excluded: they are reached by date). */
  orphans: string[];
  /** Neither link nor are linked: the notes most likely forgotten. */
  isolated: string[];
}

/**
 * Notes that need attention (PLAN §7.4): stubs (a title and a few words, linking nowhere) and notes
 * outside the link graph. Daily notes are not orphans or stubs; they are found by date, and a short
 * day is still a day. Pure and cheap: it needs only the snapshot.
 */
export function triageNotes(notes: readonly NoteRecord[], options: TriageOptions = DEFAULT_TRIAGE): Triage {
  const regular = notes.filter((note) => !DATED_NAME.test(note.basename));
  return {
    stubs: regular
      .filter((note) => note.wordCount < options.stubWords && note.outLinks.length === 0)
      .map((note) => ({ path: note.path, words: note.wordCount, inLinks: note.inLinks.length })),
    orphans: regular.filter((note) => note.inLinks.length === 0).map((note) => note.path),
    isolated: regular.filter((note) => note.inLinks.length === 0 && note.outLinks.length === 0).map((note) => note.path),
  };
}

/**
 * Where each stub could go: merged into its nearest neighbour when that is similar enough to be the
 * same subject, otherwise back to the inbox for the user. `nearest` is any similarity search.
 */
export function suggestForStubs(stubs: readonly Stub[], nearest: (path: string) => Neighbor | undefined, minScore: number): Stub[] {
  return stubs.map((stub) => {
    const neighbor = nearest(stub.path);
    const suggestion: StubSuggestion =
      neighbor && neighbor.score >= minScore ? { action: 'merge', target: neighbor.path, score: neighbor.score } : { action: 'inbox' };
    return { ...stub, suggestion };
  });
}
