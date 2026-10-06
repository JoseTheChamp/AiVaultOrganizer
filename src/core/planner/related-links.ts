import type { Charter } from '../charter/schema';
import type { VaultSnapshot } from '../model/note';
import { createOperation, type Operation, type OperationSource } from '../model/operation';

/** A link the analysis proposes, before it becomes an operation. */
export interface LinkSuggestion {
  source: string;
  target: string;
  /** Ranking score from candidate generation. */
  score: number;
  /** Set when a language model verified the pair (Tier 2). */
  verdict?: { strength: number; reason: string } | null;
}

const DEFAULT_HEADING = '## Related';

/**
 * Turns accepted link suggestions into `addRelatedLinks` operations (PLAN §7.5 step 4): one per
 * note, listing its new related notes under the charter's related heading. Idempotent by design:
 * a pair suggested both ways becomes one link (in the note that scored it higher), links that
 * already exist are not proposed again, and the executor skips any link it finds in the note. Each
 * operation is guarded by the note's content hash, so a note edited since planning is left alone.
 */
export function relatedLinkOperations(suggestions: readonly LinkSuggestion[], snapshot: VaultSnapshot, charter: Charter | null): Operation[] {
  const notes = new Map(snapshot.notes.map((note) => [note.path, note]));
  const heading = charter?.conventions.links?.relatedHeading ?? DEFAULT_HEADING;

  // One direction per pair: the higher score wins, then the alphabetically first source.
  const best = new Map<string, LinkSuggestion>();
  for (const suggestion of suggestions) {
    const source = notes.get(suggestion.source);
    if (!source || !notes.has(suggestion.target) || suggestion.source === suggestion.target) continue;
    if (source.outLinks.includes(suggestion.target) || source.inLinks.includes(suggestion.target)) continue;
    const key = suggestion.source < suggestion.target ? `${suggestion.source}\u0000${suggestion.target}` : `${suggestion.target}\u0000${suggestion.source}`;
    const current = best.get(key);
    if (!current || suggestion.score > current.score || (suggestion.score === current.score && suggestion.source < current.source)) best.set(key, suggestion);
  }

  const bySource = new Map<string, LinkSuggestion[]>();
  for (const suggestion of best.values()) bySource.set(suggestion.source, [...(bySource.get(suggestion.source) ?? []), suggestion]);

  return [...bySource.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, list]) => {
      const sorted = [...list].sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1));
      const verified = sorted.every((s) => s.verdict);
      const source: OperationSource = verified ? 'llm' : 'knn';
      const confidence = mean(sorted.map((s) => (s.verdict ? s.verdict.strength / 3 : Math.min(1, s.score))));
      const note = notes.get(path);
      return createOperation(
        { kind: 'addRelatedLinks', path, heading, targets: sorted.map((s) => s.target) },
        {
          source,
          confidence,
          rationale: rationale(sorted),
          ...(note ? { precondition: { path, contentHash: note.contentHash } } : {}),
        },
      );
    });
}

function rationale(suggestions: readonly LinkSuggestion[]): string {
  return suggestions
    .map((s) => {
      const title = s.target.slice(s.target.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      return s.verdict ? `${title}: ${s.verdict.reason}` : `${title}: similar content`;
    })
    .join('\n');
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
