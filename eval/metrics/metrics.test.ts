import { describe, expect, it } from 'vitest';
import type { GroundTruth, NoteTruth } from '../fixture/ground-truth';
import { brierScore, classificationMetrics, expectedCalibrationError, type Prediction, reliabilityBands } from './classification';
import { adjustedRandIndex, clusterMetrics, normalizedMutualInformation } from './clusters';
import { per100Notes } from './cost';
import { duplicateMetrics } from './duplicates';
import { linkMetrics } from './links';

describe('classificationMetrics', () => {
  const truth = new Map([
    ['a', 'projects'],
    ['b', 'projects'],
    ['c', 'areas'],
    ['d', 'areas'],
    ['e', 'resources'],
  ]);
  const predictions: Prediction[] = [
    { path: 'a', destination: 'projects', confidence: 1, decidedBy: 'rules' },
    { path: 'b', destination: 'areas', confidence: 1, decidedBy: 'rules' },
    { path: 'c', destination: 'areas', confidence: 0.6, decidedBy: 'llm' },
    { path: 'd', destination: null, confidence: 0, decidedBy: null },
    { path: 'e', destination: null, confidence: 0, decidedBy: null },
  ];

  it('separates coverage, accuracy and precision, and counts deciders', () => {
    const metrics = classificationMetrics(predictions, truth);
    expect(metrics).toMatchObject({ notes: 5, coverage: 0.6, accuracy: 0.4, precision: 2 / 3, decidedBy: { rules: 2, knn: 0, llm: 1 } });
    expect(metrics.confident).toEqual({ share: 0.4, accuracy: 0.5 });
  });

  it('computes macro F1 over the true classes', () => {
    // projects: P=1/1, R=1/2 → 2/3; areas: P=1/2, R=1/2 → 1/2; resources: 0.
    expect(classificationMetrics(predictions, truth).macroF1).toBeCloseTo((2 / 3 + 1 / 2 + 0) / 3, 10);
  });

  it('computes expected calibration error', () => {
    const items = [
      ...Array.from({ length: 5 }, () => ({ confidence: 0.9, correct: true })),
      ...Array.from({ length: 4 }, (_, i) => ({ confidence: 0.6, correct: i < 2 })),
    ];
    // |1 − 0.9| × 5/9 + |0.5 − 0.6| × 4/9 = 0.1
    expect(expectedCalibrationError(items)).toBeCloseTo(0.1, 10);
    expect(expectedCalibrationError([])).toBe(0);
    expect(expectedCalibrationError([{ confidence: 1, correct: true }])).toBe(0);
  });

  it('scores calibration on the uncertain decisions only, so rules do not flatter it', () => {
    const many: Prediction[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ path: `r${i}`, destination: 'projects', confidence: 1, decidedBy: 'rules' as const })),
      { path: 'k', destination: 'areas', confidence: 0.9, decidedBy: 'knn' },
      { path: 'l', destination: 'projects', confidence: 0.9, decidedBy: 'llm' },
    ];
    const manyTruth = new Map(many.map((p): [string, string] => [p.path, 'projects']));
    const metrics = classificationMetrics(many, manyTruth);
    // Both uncertain decisions claim 0.9; one is wrong.
    expect(metrics.modelEce).toBeCloseTo(0.4, 10);
    expect(metrics.ece).toBeCloseTo(0.08, 10);
    expect(metrics.modelBrier).toBeCloseTo((0.01 + 0.81) / 2, 10);
    expect(metrics.reliability).toEqual([{ from: 0.8, to: 0.9, notes: 2, confidence: 0.9, accuracy: 0.5 }]);
  });

  it('counts the most frequent mistakes', () => {
    expect(classificationMetrics(predictions, truth).confusions).toEqual([{ expected: 'projects', predicted: 'areas', count: 1 }]);
  });
});

describe('reliability and Brier', () => {
  it('bands confidences and scores them', () => {
    const items = [
      { confidence: 0, correct: false },
      { confidence: 0.5, correct: true },
      { confidence: 0.95, correct: true },
      { confidence: 1, correct: true },
    ];
    expect(reliabilityBands(items).map((band) => [band.from, band.notes, band.accuracy])).toEqual([
      [0, 2, 0.5],
      [0.9, 2, 1],
    ]);
    expect(brierScore(items)).toBeCloseTo((0 + 0.25 + 0.0025 + 0) / 4, 10);
    expect(brierScore([])).toBe(0);
  });
});

describe('cluster metrics', () => {
  it('match scikit-learn on a known example', () => {
    const truth = ['0', '0', '0', '1', '1', '1'];
    const predicted = ['0', '0', '1', '1', '2', '2'];
    expect(adjustedRandIndex(truth, predicted)).toBeCloseTo(0.24242424242424243, 12);
    expect(normalizedMutualInformation(truth, predicted)).toBeCloseTo(0.5158037429793889, 12);
  });

  it('are 1 for identical clusterings, whatever the label names', () => {
    expect(adjustedRandIndex(['a', 'a', 'b'], ['x', 'x', 'y'])).toBe(1);
    expect(normalizedMutualInformation(['a', 'a', 'b'], ['x', 'x', 'y'])).toBeCloseTo(1, 12);
    expect(clusterMetrics(new Map([['p', 'x'], ['q', 'y'], ['extra', 'z']]), new Map([['p', 'a'], ['q', 'b']]))).toMatchObject({ ari: 1, clusters: 2 });
  });

  it('are about 0 for unrelated clusterings', () => {
    expect(adjustedRandIndex(['a', 'a', 'b', 'b'], ['x', 'y', 'x', 'y'])).toBeLessThanOrEqual(0);
    expect(normalizedMutualInformation(['a', 'a', 'b', 'b'], ['x', 'y', 'x', 'y'])).toBeCloseTo(0, 12);
  });
});

const noteTruth = (entity: string, extra: Partial<NoteTruth> = {}): NoteTruth => ({
  persona: 'p',
  entity,
  kind: 'note',
  topic: entity,
  destinations: { para: { id: 'projects' }, ace: { id: 'efforts-on' }, jd: { id: 'jd-21' }, flat: { id: 'root' }, topics: { id: 'notes' } },
  isStub: false,
  ...extra,
});

const truth: GroundTruth = {
  version: 1,
  fixture: 't',
  language: 'en',
  seed: 1,
  notes: {
    a: noteTruth('website'),
    b: noteTruth('website'),
    c: noteTruth('health'),
    d: noteTruth('health', { duplicateOf: 'c' }),
    e: noteTruth('daily'),
    f: noteTruth('daily'),
  },
  trueLinks: [['a', 'b']],
  heldOutLinks: [['a', 'c']],
};

describe('linkMetrics', () => {
  it('counts linked, held-out and same-project pairs as relevant', () => {
    const suggestions = new Map([
      ['a', ['c', 'e']], // held out: relevant; daily note: not
      ['c', ['d']], // same area: relevant
      ['e', ['f']], // two daily notes: not related by that alone
      ['b', []],
    ]);
    const metrics = linkMetrics(suggestions, truth, 2);
    expect(metrics).toMatchObject({ notes: 3, k: 2, heldOutRecall: 1, suggestions: 4, relevance: 0.5 });
    expect(metrics.precision).toBeCloseTo((1 / 2 + 1 / 2 + 0 + 0) / 4, 10);
  });

  it('leaves excluded notes out as sources and from held-out recall', () => {
    const daily = (path: string): boolean => truth.notes[path]?.entity === 'daily';
    const metrics = linkMetrics(new Map([['a', ['b']], ['e', ['f']]]), { ...truth, heldOutLinks: [['a', 'c'], ['a', 'e']] }, 1, daily);
    expect(metrics).toMatchObject({ notes: 1, precision: 1, relevance: 1, heldOutRecall: 0, suggestions: 1 });
  });
});

describe('duplicateMetrics', () => {
  it('scores found pairs in either order', () => {
    expect(duplicateMetrics([['c', 'd'], ['a', 'b']], truth)).toEqual({ predicted: 2, actual: 1, precision: 0.5, recall: 1 });
    expect(duplicateMetrics([], truth)).toEqual({ predicted: 0, actual: 1, precision: 0, recall: 0 });
  });
});

describe('per100Notes', () => {
  it('normalizes cost to 100 notes', () => {
    expect(per100Notes({ calls: 3, inputTokens: 1000, outputTokens: 50, ms: 400 }, 80)).toEqual({ calls: 3.8, inputTokens: 1250, outputTokens: 63, ms: 500 });
  });
});
