import * as z from 'zod';
import type { ChatMessage } from '../types';
import { type PlanSummaryInput, planFactLines } from './plan-summary.v2';
import type { Prompt } from './types';

export interface SummaryJudgeInput {
  /** What the summary was written from: the same facts the `plan-summary` prompt saw. */
  facts: PlanSummaryInput;
  /** The summary's sentences and highlights, one statement each. */
  statements: { id: string; text: string }[];
}

export type StatementVerdict = 'supported' | 'unsupported' | 'advice';

export interface SummaryJudgeOutput {
  statements: { id: string; evidence: string; verdict: StatementVerdict }[];
}

/**
 * `summary-judge` v1 (eval only, never sent from the plugin): checks a plan summary, statement by
 * statement, against the facts it was written from. A small model asked for an overall grade reads
 * holistically and approves, and asked to find the claims itself it restates the facts instead; so the
 * eval splits the summary, and the model answers only what code cannot: which words of the facts back
 * each statement, quoted verbatim, and whether they say the same. The eval checks the quotes and plants
 * errors to measure whether this judge notices them (docs/EVALS.md).
 */
export const summaryJudgeV1: Prompt<SummaryJudgeInput, SummaryJudgeOutput> = {
  id: 'summary-judge',
  version: 1,

  build(input): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          "You check a summary of a plan that reorganizes a personal knowledge base against the plan's facts. Its owner reads the summary before approving the plan, so what it says about the plan must be backed by the facts.",
          'You get the summary as numbered statements. For each statement give:',
          'evidence: the shortest parts of the facts that back it, copied character for character (for example "moves: 12"), several parts joined with " … ", or an empty string when nothing in the facts backs it;',
          'verdict: "supported" when the evidence says the same thing with the same numbers; "unsupported" when the statement says something the facts do not, including an action the facts never mention, however plausible it sounds; "advice" when it only tells the owner what to do and says nothing about the plan.',
          'Statements may be in another language than the facts: compare meanings, but copy the evidence from the facts as they are written.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          '# Plan facts',
          ...planFactLines(input.facts),
          '',
          '# Statements',
          ...input.statements.map((statement) => `${statement.id}: ${statement.text}`),
          '',
          'Answer with JSON: {"statements": [{"id": "s1", "evidence": "...", "verdict": "supported"}]}, one entry for each statement.',
        ].join('\n'),
      },
    ];
  },

  schema(input) {
    const ids = input.statements.map((statement) => statement.id);
    return z.object({
      statements: z.array(
        z.object({
          id: z.enum(ids as [string, ...string[]]),
          evidence: z.string().trim().max(400),
          verdict: z.enum(['supported', 'unsupported', 'advice']),
        }),
      ),
    });
  },

  maxTokens(input) {
    return 300 + 100 * input.statements.length;
  },
};
