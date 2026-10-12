import { describe, expect, it } from 'vitest';
import type { PlanSummaryInput } from '../../src/core/ai/prompts/plan-summary.v2';
import { summaryJudgeV1 } from '../../src/core/ai/prompts/summary-judge.v1';
import type { PlanSummary } from '../../src/core/planner/summary';
import { ScriptedChatProvider } from '../../src/core/testing/fake-chat';
import { namesParticulars, supportedNumbers, unsupportedNumbers } from '../metrics/summary';
import { checkSummary, judgeSummary, plantErrors, statementsOf, verdictOf } from './judge';

const facts: PlanSummaryInput = {
  language: 'en',
  method: 'PARA',
  counts: ['new folders: 3', 'moves: 40', 'tag renames: 7', 'flags for you to look at: 4'],
  destinations: ['1 Projects: 25', '3 Resources: 15'],
  uncertain: 6,
  examples: ['Move "Inbox/Sourdough starter.md" to "3 Resources/Cooking/Sourdough starter.md" (41 %)', 'Remove empty folder "Inbox" (41 %)'],
  warnings: [],
};

const summary: PlanSummary = {
  summary: 'This plan moves 40 notes and creates 3 folders. Review it carefully.',
  highlights: ['Check "Sourdough starter" (41 %).', 'It makes 50 changes.'],
  source: 'model',
};

const supported = (evidence: string) => ({ evidence, verdict: 'supported' as const });

describe('summary checks by code', () => {
  it('allow the numbers in the facts and their totals, nothing else', () => {
    // 40 + 3 + 7 = 50 is a fair total; 41 and 6 are written in the facts.
    expect([40, 50, 41, 6, 25].every((n) => supportedNumbers(facts).has(n))).toBe(true);
    expect(unsupportedNumbers([summary.summary, ...summary.highlights], facts)).toEqual([]);
    expect(unsupportedNumbers(['It moves 45 notes.'], facts)).toEqual(['45']);
  });

  it('call a summary specific when it names a note or folder from the examples, not a top-level folder', () => {
    expect(namesParticulars(summary.highlights, facts)).toBe(true);
    expect(namesParticulars(['Most notes go to 3 Resources.'], facts)).toBe(false);
    expect(checkSummary(summary, facts)).toEqual({ source: 'model', unsupportedNumbers: [], specific: true });
  });
});

describe('the summary judge', () => {
  it('rules on the sentences and highlights code split, not on claims of its own', () => {
    expect(statementsOf(summary)).toEqual(['This plan moves 40 notes and creates 3 folders.', 'Review it carefully.', 'Check "Sourdough starter" (41 %).', 'It makes 50 changes.']);
  });

  it('overrules approvals whose quote is not in the facts or lacks the numbers, and leaves advice out', () => {
    const statements = statementsOf(summary).map((text, i) => ({ id: `s${i + 1}`, text }));
    const verdict = verdictOf(
      statements,
      {
        statements: [
          // Labels, spacing and joined parts do not make a quote wrong.
          { id: 's1', ...supported('Operations: moves: 40, new folders:  3') },
          { id: 's2', evidence: '', verdict: 'advice' },
          // 41 is in the facts, but this quote does not hold it.
          { id: 's3', ...supported('Move "Inbox/Sourdough starter.md" to "3 Resources/Cooking/Sourdough starter.md"') },
          // Not a quote from the facts: invented.
          { id: 's4', ...supported('total changes: 50') },
        ],
      },
      facts,
    );
    expect(verdict).toEqual({ claims: 3, supported: 1 / 3, faithful: false, unsupported: ['Check "Sourdough starter" (41 %).', 'It makes 50 changes.'], overruled: 2, advice: 1 });
  });

  it('counts unanswered statements as unsupported, and advice with a wrong number as a claim', () => {
    const verdict = verdictOf(
      [
        { id: 's1', text: 'Verify all 99 moves.' },
        { id: 's2', text: 'It moves 40 notes.' },
      ],
      { statements: [{ id: 's1', evidence: '', verdict: 'advice' }] },
      facts,
    );
    expect(verdict).toMatchObject({ claims: 2, supported: 0, unsupported: ['Verify all 99 moves.', 'It moves 40 notes.'] });
  });

  it('plants a wrong count and an invented action', () => {
    const [number, claim] = plantErrors(summary, facts);
    expect(number?.summary.summary).toBe('This plan moves 56 notes and creates 3 folders. Review it carefully.');
    expect(number?.markers).toEqual(['56']);
    expect(claim?.summary.summary).toBe('This plan moves 40 notes and creates 3 folders. Review it carefully. It also merges 4 pairs of duplicate notes.');
    expect(plantErrors({ ...summary, summary: 'Notes move.', highlights: [] }, facts).map((p) => p.kind)).toEqual(['claim']);
  });

  it('judges the summary and is checked on the planted errors', async () => {
    const real = { statements: [{ id: 's1', ...supported('moves: 40; new folders: 3') }, { id: 's2', evidence: '', verdict: 'advice' }] };
    const short: PlanSummary = { ...summary, highlights: [] };
    const provider = new ScriptedChatProvider([
      JSON.stringify(real),
      // The wrong count, approved with the right quote: overruled, so caught.
      JSON.stringify({ statements: [{ id: 's1', ...supported('moves: 40, new folders: 3') }, { id: 's2', evidence: '', verdict: 'advice' }] }),
      // The invented action, approved with a real quote that even holds its number: missed.
      JSON.stringify({ statements: [...real.statements, { id: 's3', ...supported('flags for you to look at: 4') }] }),
    ]);
    const judged = await judgeSummary(provider, short, facts);
    expect(judged).toMatchObject({ judge: { claims: 1, supported: 1, faithful: true }, controls: [{ kind: 'number', caught: true }, { kind: 'claim', caught: false }], caught: 0.5, failures: 0 });
    const prompt = provider.requests[0]?.messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).toContain('s1: This plan moves 40 notes and creates 3 folders.');
    expect(prompt).toContain('Less certain changes (below 80 %): 6');
  });

  it('only accepts answers about the statements it was given', () => {
    const schema = summaryJudgeV1.schema({ facts, statements: [{ id: 's1', text: 'x' }] });
    expect(schema.safeParse({ statements: [{ id: 's2', evidence: '', verdict: 'supported' }] }).success).toBe(false);
    expect(schema.safeParse({ statements: [{ id: 's1', evidence: '', verdict: 'maybe' }] }).success).toBe(false);
  });
});
