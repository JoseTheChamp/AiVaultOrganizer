import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets';
import { testCard } from '../testing/cards';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { InMemoryVault } from '../testing/in-memory-vault';
import { calibrate, DEFAULT_CALIBRATION } from './calibrate';
import { classifyNotes, type KnnSignal, type Placement } from './classify';
import { createLlmStage, SECOND_SAMPLE } from './llm-stage';

const knn = (destination: string, share: number, supporters: number): KnnSignal => ({ destination, share, similarity: 0.8, supporters, subfolder: null, neighbors: [] });
const placement = (overrides: Partial<Placement>): Placement => ({ path: 'a.md', destination: 'projects', subfolder: null, confidence: 0.9, source: 'llm', rationale: '', signals: {}, ...overrides });

describe('calibrate', () => {
  it('trusts rules fully and nothing undecided', () => {
    expect(calibrate(placement({ source: 'rule', confidence: 1 }))).toBe(1);
    expect(calibrate(placement({ destination: null, source: null }))).toBe(0);
  });

  it('scores kNN by vote share, tempered by the number of supporters, below certainty', () => {
    expect(calibrate(placement({ source: 'knn', signals: { knn: knn('projects', 0.8, 3) } }))).toBeCloseTo(0.8 * 0.94, 10);
    expect(calibrate(placement({ source: 'knn', signals: { knn: knn('projects', 1, 7) } }))).toBe(DEFAULT_CALIBRATION.ceiling);
  });

  it('shrinks a model self-report and moves it with agreement and disagreement', () => {
    const llm = { destination: 'projects', subfolder: null, confidence: 0.9, rationale: '' };
    expect(calibrate(placement({ signals: { llm } }))).toBeCloseTo(0.74, 10);
    expect(calibrate(placement({ signals: { llm, knn: knn('projects', 0.6, 2) } }))).toBeCloseTo(0.74 + 0.1 * 0.6, 10);
    expect(calibrate(placement({ signals: { llm, knn: knn('areas', 0.6, 2) } }))).toBeCloseTo(0.74 - 0.2 * 0.6, 10);
    expect(calibrate(placement({ signals: { llm: { ...llm, agreement: true } } }))).toBeCloseTo(0.84, 10);
    expect(calibrate(placement({ signals: { llm: { ...llm, agreement: false } } }))).toBeCloseTo(0.54, 10);
  });

  it('never presents a learned decision as certain', () => {
    const llm = { destination: 'projects', subfolder: null, confidence: 1, rationale: '', agreement: true };
    expect(calibrate(placement({ signals: { llm, knn: knn('projects', 1, 5) } }))).toBe(DEFAULT_CALIBRATION.ceiling);
  });
});

describe('second sample', () => {
  it('asks again about borderline answers only, in a different order, and records agreement', async () => {
    const vault = InMemoryVault.from({ 'a.md': 'A.', 'b.md': 'B.', 'c.md': 'C.' });
    const snapshot = await vault.snapshot();
    const cards = new Map(['a.md', 'b.md', 'c.md'].map((path) => [path, testCard(path)]));
    const reply = (...notes: [string, string, number][]) => JSON.stringify({ notes: notes.map(([noteId, destinationId, confidence]) => ({ noteId, destinationId, subfolder: null, confidence, rationale: 'r' })) });
    const provider = new ScriptedChatProvider([
      reply(['n1', 'projects', 0.6], ['n2', 'areas', 0.95], ['n3', 'resources', 0.5]),
      // Second ask, borderline notes reversed: c first, then a.
      reply(['n1', 'archive', 0.5], ['n2', 'projects', 0.7]),
    ]);
    const model = createLlmStage({ provider, cards, folders: [], secondSample: SECOND_SAMPLE });
    const { placements } = await classifyNotes({ snapshot, charter: presetCharter('para', 'en'), charterPath: null, llm: model.stage });
    expect(placements.get('a.md')?.signals.llm?.agreement).toBe(true);
    expect(placements.get('b.md')?.signals.llm?.agreement).toBeUndefined();
    expect(placements.get('c.md')?.signals.llm?.agreement).toBe(false);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages[1]?.content.indexOf('Title: c')).toBeLessThan(provider.requests[1]?.messages[1]?.content.indexOf('Title: a') ?? 0);
  });
});
