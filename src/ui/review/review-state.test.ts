import { describe, expect, it } from 'vitest';
import type { ValidationReport } from '../../core/apply/validate';
import { presetCharter } from '../../core/charter/presets/index';
import { createOperation } from '../../core/model/operation';
import { createPlan } from '../../core/model/plan';
import { acceptAbove, ATTENTION, decide, decidedPlan, decisionCounts, destinationsOf, groupItems, initialDecisions, matches, NO_FILTERS, reviewItems } from './review-state';

const move = createOperation({ kind: 'move', from: 'Plan.md', to: '1 Projects/Website/Plan.md' }, { source: 'knn', confidence: 0.9, rationale: 'Similar to the website notes.' });
const rename = createOperation({ kind: 'renameProperty', path: '1 Projects/Website/Plan.md', from: 'Type', to: 'type' }, { source: 'rule', confidence: 1, dependsOn: [move.id] });
const archive = createOperation({ kind: 'move', from: 'Old.md', to: '4 Archive/Old.md' }, { source: 'llm', confidence: 0.4 });
const flag = createOperation({ kind: 'flag', path: 'Odd.md', issue: 'ambiguous' }, { confidence: 0 });
const folder = createOperation({ kind: 'createFolder', path: '1 Projects/Website' }, { source: 'rule', confidence: 1, status: 'accepted' });
const plan = createPlan({ id: 'p', createdAt: '2026-10-07T00:00:00.000Z', operations: [folder, move, rename, archive, flag] });
const validation: ValidationReport = { ok: true, issues: [{ code: 'stale-precondition', severity: 'warning', message: 'Old.md changed.', opId: archive.id }], staleOpIds: [] };
const items = reviewItems(plan, validation, presetCharter('para', 'en'));

describe('review state', () => {
  it('groups moves by destination and puts flags first', () => {
    expect(groupItems(items).map((group) => [group.title, group.items.length])).toEqual([
      [ATTENTION, 1],
      ['New folders', 1],
      ['Moves into 1 Projects', 1],
      ['Moves into 4 Archive', 1],
      ['Property renames', 1],
    ]);
    expect(items.find((item) => item.op.id === archive.id)?.issues).toEqual([{ severity: 'warning', message: 'Old.md changed.' }]);
    expect(destinationsOf(items)).toEqual(['1 Projects', '4 Archive']);
  });

  it('starts from the saved statuses', () => {
    const decisions = initialDecisions(plan);
    expect(decisions.get(folder.id)).toBe('accepted');
    expect(decisions.get(move.id)).toBe('pending');
    expect(decisionCounts(items, decisions)).toEqual({ pending: 3, accepted: 1, rejected: 0 });
  });

  it('accepts what an edit waits for, and rejects what waits for a rejected move', () => {
    const accepted = decide(plan, initialDecisions(plan), [rename.id], 'accepted');
    expect(accepted.get(move.id)).toBe('accepted');
    const rejected = decide(plan, accepted, [move.id], 'rejected');
    expect(rejected.get(rename.id)).toBe('rejected');
    // Flags are never decided.
    expect(decide(plan, rejected, [flag.id], 'accepted').get(flag.id)).toBeUndefined();
  });

  it('bulk-accepts shown, undecided operations at or above a threshold', () => {
    const decisions = acceptAbove(plan, initialDecisions(plan), items, 0.8);
    expect([move, rename, archive].map((op) => decisions.get(op.id))).toEqual(['accepted', 'accepted', 'pending']);
  });

  it('filters by source, confidence, destination, status and text', () => {
    const shown = (filters: Partial<typeof NO_FILTERS>) => items.filter((item) => matches(item, 'pending', { ...NO_FILTERS, ...filters })).map((item) => item.op.id);
    expect(shown({ source: 'llm' })).toEqual([archive.id]);
    expect(shown({ minConfidence: 0.5 })).toEqual([folder.id, move.id, rename.id, flag.id]);
    expect(shown({ destination: '4 Archive' })).toEqual([archive.id]);
    expect(shown({ query: 'website notes' })).toEqual([move.id]);
    expect(shown({ status: 'accepted' })).toEqual([]);
  });

  it('turns decisions into statuses; flags and undecided operations stay pending', () => {
    const decided = decidedPlan(plan, decide(plan, initialDecisions(plan), [archive.id], 'rejected'));
    expect(decided.operations.map((op) => op.status)).toEqual(['accepted', 'pending', 'pending', 'rejected', 'pending']);
  });
});
