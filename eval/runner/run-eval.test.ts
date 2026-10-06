import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_METHOD_KEYS, loadFixture } from '../fixture/ground-truth';
import { FIXTURES_DIR } from '../fixture/specs';
import { runEval } from './run-eval';
import { summarize } from './summary';

const fixture = await loadFixture(path.join(FIXTURES_DIR, 'en-small'));

describe('runEval on en-small', { timeout: 60_000 }, () => {
  it('replays stored embeddings offline and measures every task', async () => {
    const result = await runEval(fixture, { tier: 1, record: false, embedModel: 'bge-m3', indexDir: path.join('eval', 'cassettes', 'index', 'en-small') });
    expect(result.notices).toEqual([]);
    expect(Object.keys(result.links).sort()).toEqual(['embeddings', 'words']);
    expect(result.cost.embeddings?.calls).toBe(0);
    for (const method of FIXTURE_METHOD_KEYS) {
      // Rules are deterministic: whatever they decide must be right.
      const { coverage, precision } = result.classification[method];
      if (coverage > 0) expect(precision).toBe(1);
    }
    expect(result.safety).toMatchObject({ brokenLinks: 0, undoExact: true, failed: 0 });
    expect(result.safety.applied).toBe(result.safety.operations);
    expect(summarize(result)).toContain('en-small (en, 82 notes, tier 1)');
  });

  it('skips tier 1 with a notice when no vectors are stored', async () => {
    const result = await runEval(fixture, { tier: 1, record: false, embedModel: 'not-recorded', indexDir: path.join('eval', 'cassettes', 'index', 'en-small') });
    expect(Object.keys(result.links)).toEqual(['words']);
    expect(result.notices).toEqual([expect.stringContaining('no stored not-recorded vectors')]);
  });

  it('runs only rules and words at tier 0', async () => {
    const result = await runEval(fixture, { tier: 0, record: false, embedModel: 'bge-m3', indexDir: 'unused' });
    expect(result.embedModel).toBeNull();
    expect(Object.keys(result.similarity)).toEqual(['words']);
  });
});
