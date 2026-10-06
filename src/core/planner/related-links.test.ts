import { describe, expect, it } from 'vitest';
import { ApplyRunService } from '../apply/run';
import { presetCharter } from '../charter/presets';
import { createPlan } from '../model/plan';
import { applyHarness } from '../testing/apply-harness';
import { relatedLinkOperations } from './related-links';

const files = {
  'Garden/Tomatoes.md': 'Seedlings need light.',
  'Garden/Compost.md': 'Turn it often. See [[Tomatoes]].',
  'Garden/Beds.md': 'Raised beds.',
  'Running/Plan.md': 'Four runs a week.',
};

describe('relatedLinkOperations', () => {
  it('makes one operation per note, one link per pair, and skips existing links', async () => {
    const { vault } = applyHarness(files);
    const snapshot = await vault.snapshot();
    const operations = relatedLinkOperations(
      [
        { source: 'Garden/Tomatoes.md', target: 'Garden/Beds.md', score: 0.9, verdict: { strength: 3, reason: 'Same garden.' } },
        { source: 'Garden/Beds.md', target: 'Garden/Tomatoes.md', score: 0.7 },
        { source: 'Garden/Tomatoes.md', target: 'Garden/Compost.md', score: 0.95 },
        { source: 'Garden/Beds.md', target: 'Garden/Compost.md', score: 0.6, verdict: { strength: 2, reason: 'Soil for the beds.' } },
        { source: 'Garden/Beds.md', target: 'Missing.md', score: 0.9 },
      ],
      snapshot,
      presetCharter('para', 'cs'),
    );
    expect(operations).toEqual([
      expect.objectContaining({
        kind: 'addRelatedLinks',
        path: 'Garden/Beds.md',
        heading: '## Související',
        targets: ['Garden/Compost.md'],
        source: 'llm',
        rationale: 'Compost: Soil for the beds.',
      }),
      expect.objectContaining({ path: 'Garden/Tomatoes.md', targets: ['Garden/Beds.md'], source: 'llm', confidence: 1, rationale: 'Beds: Same garden.' }),
    ]);
    const beds = snapshot.notes.find((note) => note.path === 'Garden/Beds.md');
    expect(operations[0]?.precondition).toEqual({ path: 'Garden/Beds.md', contentHash: beds?.contentHash });
  });

  it('applies through the real executor, and re-planning afterwards proposes nothing', async () => {
    const { vault, deps, storage, clock } = applyHarness(files);
    const plan = (operations: ReturnType<typeof relatedLinkOperations>) =>
      createPlan({ id: 'links', createdAt: '2026-10-07T00:00:00.000Z', operations: operations.map((op) => ({ ...op, status: 'accepted' as const })) });
    const suggestions = [{ source: 'Garden/Beds.md', target: 'Garden/Tomatoes.md', score: 0.8 }];
    const first = relatedLinkOperations(suggestions, await vault.snapshot(), null);
    const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan(first), { pluginVersion: 'test' });
    expect(outcome.kind === 'ran' && outcome.report.applied).toBe(1);
    expect(await vault.read('Garden/Beds.md')).toBe('Raised beds.\n\n## Related\n- [[Tomatoes]]\n');
    expect(first[0]).toMatchObject({ source: 'knn', rationale: 'Tomatoes: similar content' });
    expect(relatedLinkOperations(suggestions, await vault.snapshot(), null)).toEqual([]);
  });
});
