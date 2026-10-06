import { type GroundTruth, pairKey } from '../fixture/ground-truth';
import { ratio } from './classification';

export interface DuplicateMetrics {
  predicted: number;
  actual: number;
  precision: number;
  recall: number;
}

/** Near-duplicate detection against the ground truth's `duplicateOf` pairs (PLAN §8.2). */
export function duplicateMetrics(predicted: readonly (readonly [string, string])[], truth: GroundTruth): DuplicateMetrics {
  const actual = new Set(
    Object.entries(truth.notes)
      .filter(([, note]) => note.duplicateOf !== undefined)
      .map(([path, note]) => pairKey(path, note.duplicateOf as string)),
  );
  const found = new Set(predicted.map(([a, b]) => pairKey(a, b)));
  const hits = [...found].filter((key) => actual.has(key)).length;
  return { predicted: found.size, actual: actual.size, precision: ratio(hits, found.size), recall: ratio(hits, actual.size) };
}
