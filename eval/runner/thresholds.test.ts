import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../fixture/ground-truth';
import { FIXTURES_DIR } from '../fixture/specs';
import { runEval } from './run-eval';
import { baselineThresholds, checkThresholds, metricAt, readThresholds } from './thresholds';

const result = await runEval(await loadFixture(path.join(FIXTURES_DIR, 'en-small')), {
  tier: 1,
  record: false,
  embedModel: 'bge-m3',
  indexDir: path.join('eval', 'cassettes', 'index', 'en-small'),
});

describe('thresholds', () => {
  it('read metrics by path, booleans as 1 and 0', () => {
    expect(metricAt(result, 'safety.undoExact')).toBe(1);
    expect(metricAt(result, 'safety.brokenLinks')).toBe(0);
    expect(metricAt(result, 'links.words.precision')).toBe(result.links.words?.precision);
    expect(metricAt(result, 'links.nope.precision')).toBeUndefined();
  });

  it('pass for the baseline and catch regressions beyond the tolerance', () => {
    const thresholds = baselineThresholds([result], 0.02);
    expect(checkThresholds(result, thresholds)).toEqual([]);
    const words = result.links.words;
    if (!words) throw new Error('words missing');
    const slightlyWorse = { ...result, links: { ...result.links, words: { ...words, precision: words.precision - 0.01 } } };
    expect(checkThresholds(slightlyWorse, thresholds)).toEqual([]);
    const worse = { ...result, links: { ...result.links, words: { ...words, precision: words.precision - 0.05 } } };
    expect(checkThresholds(worse, thresholds)).toEqual([expect.stringMatching(/^en-small links\.words\.precision: 0\.\d{3} is below 0\.\d{3}$/)]);
    const unsafe = { ...result, safety: { ...result.safety, brokenLinks: 1, undoExact: false } };
    expect(checkThresholds(unsafe, thresholds)).toEqual([
      'en-small safety.undoExact: 0.000 is below 1',
      'en-small safety.brokenLinks: 1.000 is above 0',
    ]);
  });

  it('report tasks that did not run and fixtures without thresholds', () => {
    const thresholds = baselineThresholds([result], 0.02);
    const wordsOnly = { ...result, links: { words: result.links.words }, similarity: { words: result.similarity.words } };
    expect(checkThresholds(wordsOnly, thresholds)).toContain('en-small links.embeddings.precision: not measured (was a task skipped?)');
    expect(checkThresholds({ ...result, fixture: 'other' }, thresholds)).toEqual(['other: no thresholds; add them with --update-thresholds']);
  });

  it('are committed for every CI fixture and hold today', async () => {
    const committed = await readThresholds();
    expect(Object.keys(committed.fixtures).sort()).toEqual(['cs-small', 'en-small']);
    expect(checkThresholds(result, committed)).toEqual([]);
  });
});
