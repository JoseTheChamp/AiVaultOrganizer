import { readFile, writeFile } from 'node:fs/promises';
import * as z from 'zod';
import { FIXTURE_METHOD_KEYS } from '../fixture/ground-truth';
import { type EvalResult, STAGES } from './run-eval';

/**
 * Regression thresholds for the replayed evals (PLAN §8.3): per fixture, metric paths into an
 * EvalResult with a floor (`min`) or a ceiling (`max`). CI fails when a metric falls more than
 * `tolerance` past its bound. Bounds are raised only deliberately, with `--update-thresholds`.
 */
export const thresholdsSchema = z.object({
  tolerance: z.number().min(0),
  fixtures: z.record(z.string(), z.record(z.string(), z.object({ min: z.number().optional(), max: z.number().optional() }))),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

export const THRESHOLDS_FILE = 'eval/thresholds.json';

/** Metrics pinned in CI. Floors unless listed as ceilings. */
const PINNED = [
  ...FIXTURE_METHOD_KEYS.flatMap((method) => [
    ...STAGES.flatMap((stage) => [`classification.${method}.${stage}.coverage`, `classification.${method}.${stage}.precision`]),
    `classification.${method}.llm.accuracy`,
    `classification.${method}.llm.subfolderAccuracy`,
  ]),
  ...['words', 'embeddings'].flatMap((method) => [
    `links.${method}.precision`,
    `links.${method}.heldOutRecall`,
    `similarity.${method}.precision`,
    `clusters.${method}.topic.ari`,
    `duplicates.${method}.precision`,
    `duplicates.${method}.recall`,
  ]),
  'links.verified.precision',
  'links.verified.relevance',
  'links.verified.heldOutRecall',
  'stubs.precision',
  'stubs.recall',
  'plan.undoExact',
  'safety.undoExact',
];
const CEILINGS = [
  // Calibration: the confidences the review shows must keep meaning what they say.
  ...FIXTURE_METHOD_KEYS.map((method) => `classification.${method}.llm.ece`),
  'plan.errors',
  'plan.failed',
  'plan.brokenLinks',
  'safety.brokenLinks',
  'safety.failed',
  'labels.failures',
];

/** A metric by its dotted path; booleans count as 1 and 0. Undefined when the task did not run. */
export function metricAt(result: EvalResult, path: string): number | undefined {
  let value: unknown = result;
  for (const key of path.split('.')) value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return typeof value === 'number' ? value : undefined;
}

/** Human-readable failures; empty when every pinned metric is within bounds. */
export function checkThresholds(result: EvalResult, thresholds: Thresholds): string[] {
  const bounds = thresholds.fixtures[result.fixture];
  if (!bounds) return [`${result.fixture}: no thresholds; add them with --update-thresholds`];
  const failures: string[] = [];
  for (const [path, { min, max }] of Object.entries(bounds)) {
    const value = metricAt(result, path);
    if (value === undefined) {
      failures.push(`${result.fixture} ${path}: not measured (was a task skipped?)`);
      continue;
    }
    if (min !== undefined && value < min - thresholds.tolerance) failures.push(`${result.fixture} ${path}: ${value.toFixed(3)} is below ${min}`);
    if (max !== undefined && value > max + thresholds.tolerance) failures.push(`${result.fixture} ${path}: ${value.toFixed(3)} is above ${max}`);
  }
  return failures;
}

/** Today's numbers as the new bounds (floors rounded down, ceilings up, to 3 decimals). */
export function baselineThresholds(results: readonly EvalResult[], tolerance: number): Thresholds {
  const fixtures: Thresholds['fixtures'] = {};
  for (const result of results) {
    const bounds: Record<string, { min?: number; max?: number }> = {};
    for (const path of PINNED) {
      const value = metricAt(result, path);
      if (value !== undefined) bounds[path] = { min: Math.floor(value * 1000) / 1000 };
    }
    for (const path of CEILINGS) {
      const value = metricAt(result, path);
      if (value !== undefined) bounds[path] = { max: Math.ceil(value * 1000) / 1000 };
    }
    fixtures[result.fixture] = bounds;
  }
  return { tolerance, fixtures };
}

export async function readThresholds(file = THRESHOLDS_FILE): Promise<Thresholds> {
  return thresholdsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

export async function writeThresholds(thresholds: Thresholds, file = THRESHOLDS_FILE): Promise<void> {
  await writeFile(file, `${JSON.stringify(thresholds, null, 2)}\n`);
}
