/** How a note was placed, in cascade order (PLAN §7.6). */
export type Decider = 'rules' | 'knn' | 'llm';

export interface Prediction {
  path: string;
  /** Destination id, or null when the method abstained. */
  destination: string | null;
  /** 0..1; rules are certain (1). */
  confidence: number;
  decidedBy: Decider | null;
}

export interface ClassificationMetrics {
  notes: number;
  /** Share of notes that got a destination (not abstained). */
  coverage: number;
  /** Correct over all notes; an abstention counts as not correct. */
  accuracy: number;
  /** Correct over decided notes: how far a decision can be trusted. */
  precision: number;
  /** Mean F1 over the true destinations (abstentions lower recall). */
  macroF1: number;
  /** Expected calibration error over decided notes, 10 equal-width confidence bins. */
  ece: number;
  /** Decided notes with confidence ≥ 0.8: their share of all notes and their accuracy. */
  confident: { share: number; accuracy: number };
  /** Notes decided by each stage. */
  decidedBy: Record<Decider, number>;
  /**
   * ECE over the uncertain decisions only (similar notes and the model). Rules claim 1.0 and are always
   * right, so in `ece` they dilute the error and make the uncertain decisions look better calibrated.
   */
  modelEce: number;
  /**
   * Brier score over the same uncertain decisions: the mean squared gap between confidence and outcome
   * (0 is perfect, 0.25 is a coin flip at 50 %). A proper scoring rule, so unlike ECE it rewards
   * confidences that separate right from wrong, not only ones that average out per bin.
   */
  modelBrier: number;
  /** The uncertain decisions per confidence band, and how often they were right: a reliability diagram in numbers. */
  reliability: ReliabilityBand[];
  /** The most frequent mistakes, most frequent first: where descriptions or prompts need work. */
  confusions: { expected: string; predicted: string; count: number }[];
}

export interface ReliabilityBand {
  /** Confidence from (exclusive, except for the first band) and to (inclusive). */
  from: number;
  to: number;
  notes: number;
  /** Mean confidence in the band. */
  confidence: number;
  /** Share right in the band. */
  accuracy: number;
}

/** Bands of the reliability table: wider at the bottom, where few decisions fall, finer where review looks. */
const BANDS = [0, 0.5, 0.7, 0.8, 0.9, 1];
const CONFUSIONS = 3;

/** Classification quality against the ground truth destinations (PLAN §8.2). */
export function classificationMetrics(predictions: readonly Prediction[], truth: ReadonlyMap<string, string>): ClassificationMetrics {
  const scored = predictions.filter((p) => truth.has(p.path));
  const n = scored.length;
  const decided = scored.filter((p) => p.destination !== null);
  const correct = (p: Prediction): boolean => p.destination === truth.get(p.path);
  const decidedBy: Record<Decider, number> = { rules: 0, knn: 0, llm: 0 };
  for (const p of decided) if (p.decidedBy) decidedBy[p.decidedBy]++;
  const confident = decided.filter((p) => p.confidence >= 0.8);
  const uncertain = decided.filter((p) => p.decidedBy !== 'rules').map((p) => ({ confidence: p.confidence, correct: correct(p) }));
  return {
    notes: n,
    coverage: ratio(decided.length, n),
    accuracy: ratio(decided.filter(correct).length, n),
    precision: ratio(decided.filter(correct).length, decided.length),
    macroF1: macroF1(scored, truth),
    ece: expectedCalibrationError(decided.map((p) => ({ confidence: p.confidence, correct: correct(p) }))),
    confident: { share: ratio(confident.length, n), accuracy: ratio(confident.filter(correct).length, confident.length) },
    decidedBy,
    modelEce: expectedCalibrationError(uncertain),
    modelBrier: brierScore(uncertain),
    reliability: reliabilityBands(uncertain),
    confusions: topConfusions(decided.filter((p) => !correct(p)).map((p) => [truth.get(p.path) as string, p.destination as string])),
  };
}

/** Mean squared gap between confidence and outcome; 0 when there is nothing to score. */
export function brierScore(items: readonly { confidence: number; correct: boolean }[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + (item.confidence - (item.correct ? 1 : 0)) ** 2, 0) / items.length;
}

/** Items per confidence band (empty bands left out), with mean confidence and accuracy. */
export function reliabilityBands(items: readonly { confidence: number; correct: boolean }[]): ReliabilityBand[] {
  const bands: ReliabilityBand[] = [];
  for (let b = 0; b < BANDS.length - 1; b++) {
    const [from, to] = [BANDS[b] as number, BANDS[b + 1] as number];
    const inBand = items.filter((item) => (item.confidence > from || (b === 0 && item.confidence >= from)) && item.confidence <= to);
    if (inBand.length === 0) continue;
    const confidence = inBand.reduce((sum, item) => sum + item.confidence, 0) / inBand.length;
    bands.push({ from, to, notes: inBand.length, confidence, accuracy: ratio(inBand.filter((item) => item.correct).length, inBand.length) });
  }
  return bands;
}

function topConfusions(pairs: readonly [string, string][]): ClassificationMetrics['confusions'] {
  const counts = new Map<string, { expected: string; predicted: string; count: number }>();
  for (const [expected, predicted] of pairs) {
    const key = `${expected}\u0000${predicted}`;
    const entry = counts.get(key) ?? { expected, predicted, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected)).slice(0, CONFUSIONS);
}

function macroF1(predictions: readonly Prediction[], truth: ReadonlyMap<string, string>): number {
  const classes = [...new Set(predictions.map((p) => truth.get(p.path) as string))];
  if (classes.length === 0) return 0;
  let sum = 0;
  for (const cls of classes) {
    const tp = predictions.filter((p) => p.destination === cls && truth.get(p.path) === cls).length;
    const predicted = predictions.filter((p) => p.destination === cls).length;
    const actual = predictions.filter((p) => truth.get(p.path) === cls).length;
    const precision = ratio(tp, predicted);
    const recall = ratio(tp, actual);
    sum += precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  }
  return sum / classes.length;
}

/**
 * ECE: the gap between how confident decisions claim to be and how often they are right, averaged
 * over confidence bins weighted by their size. 0 is perfectly calibrated.
 */
export function expectedCalibrationError(items: readonly { confidence: number; correct: boolean }[], bins = 10): number {
  if (items.length === 0) return 0;
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const low = b / bins;
    const high = (b + 1) / bins;
    const inBin = items.filter((item) => (item.confidence > low && item.confidence <= high) || (b === 0 && item.confidence === 0));
    if (inBin.length === 0) continue;
    const accuracy = inBin.filter((item) => item.correct).length / inBin.length;
    const confidence = inBin.reduce((sum, item) => sum + item.confidence, 0) / inBin.length;
    total += (inBin.length / items.length) * Math.abs(accuracy - confidence);
  }
  return total;
}

export function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
