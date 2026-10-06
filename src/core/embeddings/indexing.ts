import type { NoteRecord } from '../model/note';

/** Called as indexing advances; `done` counts notes processed out of `total` that needed work. */
export type ProgressListener = (progress: { done: number; total: number }) => void;

export interface IndexOptions {
  onProgress?: ProgressListener;
  /** Checked between batches; when it returns true, indexing stops after saving what it has. */
  isCancelled?: () => boolean;
}

export interface IndexReport {
  /** Notes (re)indexed in this run. */
  indexed: number;
  /** Notes whose stored entry still matched their content hash. */
  unchanged: number;
  /** Entries dropped because their note is gone or no longer eligible. */
  removed: number;
  /** Notes that still need indexing because the run was cancelled or failed. */
  remaining: number;
  cancelled: boolean;
  /** Provider tokens used (embeddings only). */
  tokens: number;
}

export interface IndexPlan {
  /** Notes that are new or whose content changed, sorted by path. */
  stale: NoteRecord[];
  unchanged: number;
  /** Indexed paths that are no longer among the notes. */
  removed: string[];
}

/**
 * What an incremental update has to do: a note is re-indexed only when its content hash differs
 * from the one its stored entry was computed from (PLAN §7.3).
 */
export function planIndexUpdate(notes: readonly NoteRecord[], stored: ReadonlyMap<string, string>): IndexPlan {
  const current = new Set(notes.map((note) => note.path));
  const stale = notes.filter((note) => stored.get(note.path) !== note.contentHash).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    stale,
    unchanged: notes.length - stale.length,
    removed: [...stored.keys()].filter((path) => !current.has(path)).sort(),
  };
}
