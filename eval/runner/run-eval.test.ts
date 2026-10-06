import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_METHOD_KEYS, loadFixture } from '../fixture/ground-truth';
import { FIXTURES_DIR } from '../fixture/specs';
import { type EvalOptions, runEval } from './run-eval';
import { summarize } from './summary';

const fixture = await loadFixture(path.join(FIXTURES_DIR, 'en-small'));
const options: EvalOptions = {
  tier: 1,
  record: false,
  embedModel: 'bge-m3',
  chatModel: 'qwen3:8b',
  indexDir: path.join('eval', 'cassettes', 'index', 'en-small'),
};

describe('runEval on en-small', { timeout: 120_000 }, () => {
  it('replays stored embeddings offline and measures every task', async () => {
    const result = await runEval(fixture, options);
    expect(result.notices).toEqual([]);
    expect(Object.keys(result.links).sort()).toEqual(['embeddings', 'words']);
    expect(Object.keys(result.clusters).sort()).toEqual(['embeddings', 'folders', 'words']);
    expect(result.cost.embeddings?.calls).toBe(0);
    for (const method of FIXTURE_METHOD_KEYS) {
      // Rules are deterministic: whatever they decide must be right.
      const { coverage, precision } = result.classification[method];
      if (coverage > 0) expect(precision).toBe(1);
    }
    expect(result.stubs.recall).toBe(1);
    expect(result.safety).toMatchObject({ brokenLinks: 0, undoExact: true, failed: 0 });
    expect(result.safety.applied).toBe(result.safety.operations);
    expect(summarize(result)).toContain('en-small (en, 82 notes, tier 1)');
  });

  it('replays the recorded language model answers at tier 2', async () => {
    const result = await runEval(fixture, { ...options, tier: 2 });
    expect(result.notices).toEqual([]);
    expect(result.links.verified?.suggestions).toBeGreaterThan(0);
    expect(result.labels?.failures).toBe(0);
    expect(result.cost.chat?.calls).toBeGreaterThan(0);
  });

  it('skips tiers with a notice when nothing was recorded for the models', async () => {
    const result = await runEval(fixture, { ...options, tier: 2, embedModel: 'not-recorded', chatModel: 'not-recorded' });
    expect(Object.keys(result.links)).toEqual(['words']);
    expect(result.notices).toEqual([expect.stringContaining('no stored not-recorded vectors'), expect.stringContaining('no recorded not-recorded answers')]);
  });

  it('runs only rules and words at tier 0', async () => {
    const result = await runEval(fixture, { ...options, tier: 0 });
    expect(result.embedModel).toBeNull();
    expect(Object.keys(result.similarity)).toEqual(['words']);
  });
});
