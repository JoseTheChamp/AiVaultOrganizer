import { type GroundTruth, pairKey } from '../fixture/ground-truth';
import { ratio } from './classification';

export interface LinkMetrics {
  /** Notes that got at least one suggestion. */
  notes: number;
  k: number;
  /** Mean share of the k suggestion slots filled with a relevant note (missing slots count as misses). */
  precision: number;
  /** Share of held-out links found among the suggestions (in either direction). */
  heldOutRecall: number;
  suggestions: number;
}

/** Groups whose members are not related to each other just by being in the group. */
const LOOSE_ENTITIES = new Set(['daily', 'books', 'people']);

/**
 * Link suggestion quality (PLAN §8.2). A suggested pair is relevant when the fixture links it, the
 * messify step removed it (held out), or both notes belong to the same project, area or topic:
 * those are links a careful author would accept.
 */
export function linkMetrics(suggestions: ReadonlyMap<string, readonly string[]>, truth: GroundTruth, k: number): LinkMetrics {
  const linked = new Set([...truth.trueLinks, ...truth.heldOutLinks].map(([a, b]) => pairKey(a, b)));
  const relevant = (a: string, b: string): boolean => {
    if (linked.has(pairKey(a, b))) return true;
    const ea = truth.notes[a]?.entity;
    return ea !== undefined && !LOOSE_ENTITIES.has(ea) && ea === truth.notes[b]?.entity;
  };
  let notes = 0;
  let precision = 0;
  let total = 0;
  const suggested = new Set<string>();
  for (const [path, list] of suggestions) {
    const top = list.slice(0, k);
    total += top.length;
    if (top.length > 0) notes++;
    precision += top.filter((other) => relevant(path, other)).length / k;
    for (const other of top) suggested.add(pairKey(path, other));
  }
  const heldOut = truth.heldOutLinks.map(([a, b]) => pairKey(a, b));
  return {
    notes,
    k,
    precision: ratio(precision, suggestions.size),
    heldOutRecall: ratio(heldOut.filter((key) => suggested.has(key)).length, heldOut.length),
    suggestions: total,
  };
}
