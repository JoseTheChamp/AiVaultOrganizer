import type { Placement } from './classify';

export interface CalibrationOptions {
  /** How far a model's self-reported confidence is trusted (0 = not at all, 1 = fully). */
  llmTrust: number;
  /** Added when the model and kNN agree (scaled by kNN's vote share)… */
  agreementBonus: number;
  /** …and subtracted when they disagree. */
  disagreementPenalty: number;
  /** Added when a second sample of the model gives the same answer… */
  sampleBonus: number;
  /** …and subtracted when it gives another. */
  samplePenalty: number;
  /** No learned decision is ever presented as certain; only rules are. */
  ceiling: number;
}

/**
 * Hand-set from the eval fixtures and checked with ECE (docs/EVALS.md). Deliberately not fitted on
 * them: with 82 notes per fixture, a fitted curve would describe the fixtures, not vaults. The
 * second-sample weights follow one measurement: on en-small, answers the second sample confirmed
 * were right 92 % of the time, and those it contradicted 34 %; qwen3:8b reported 0.9 for both.
 */
export const DEFAULT_CALIBRATION: CalibrationOptions = { llmTrust: 0.6, agreementBonus: 0.1, disagreementPenalty: 0.2, sampleBonus: 0.15, samplePenalty: 0.35, ceiling: 0.95 };

/**
 * One confidence per placement from all the evidence behind it (PLAN §7.6 "Calibration"):
 *
 * - rules (and notes already where the charter puts them) are certain;
 * - kNN is its vote share, tempered by how many neighbours voted;
 * - a model's self-report is shrunk towards 0.5, because models are overconfident, then raised
 *   when kNN or a second sample agree and lowered when they disagree.
 *
 * The bulk "accept above X" in the review relies on these numbers, so they are measured with
 * expected calibration error in every eval run.
 */
export function calibrate(placement: Placement, options: CalibrationOptions = DEFAULT_CALIBRATION): number {
  if (placement.destination === null || placement.source === null) return 0;
  if (placement.source === 'rule') return 1;
  const { knn, llm } = placement.signals;
  if (placement.source === 'knn') {
    if (!knn) return clamp(placement.confidence, options.ceiling);
    // Three supporters is the minimum to decide; five or more is full weight.
    const support = 0.85 + 0.03 * Math.min(5, knn.supporters);
    return clamp(knn.share * support, options.ceiling);
  }
  const reported = llm?.confidence ?? placement.confidence;
  let confidence = 0.5 + (reported - 0.5) * options.llmTrust;
  if (knn) {
    confidence += knn.destination === placement.destination ? options.agreementBonus * knn.share : -options.disagreementPenalty * knn.share;
  }
  if (llm?.agreement === true) confidence += options.sampleBonus;
  if (llm?.agreement === false) confidence -= options.samplePenalty;
  return clamp(confidence, options.ceiling);
}

/** Replaces every placement's confidence with its calibrated value (the raw signals are kept). */
export function calibrateAll(placements: Map<string, Placement>, options: CalibrationOptions = DEFAULT_CALIBRATION): void {
  for (const [path, placement] of placements) placements.set(path, { ...placement, confidence: calibrate(placement, options) });
}

function clamp(value: number, ceiling: number): number {
  return Math.max(0, Math.min(ceiling, value));
}
