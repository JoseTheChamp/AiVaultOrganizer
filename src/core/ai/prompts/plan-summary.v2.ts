import * as z from 'zod';
import type { ChatMessage } from '../types';
import { languageName, type Prompt } from './types';

export interface PlanSummaryInput {
  language: 'en' | 'cs';
  method: string;
  /** "12 moves", "3 new folders"… */
  counts: string[];
  /** Notes each destination receives, e.g. "Projects: 14". */
  destinations: string[];
  /** Changes below 80 % confidence, flags not included: the ones review should start with. */
  uncertain: number;
  /** A few operations as one-line descriptions, least certain first, with the confidence of those not certain. */
  examples: string[];
  warnings: string[];
}

export interface PlanSummaryOutput {
  summary: string;
  highlights: string[];
}

/**
 * `plan-summary` v2 (PLAN §7.8): two or three sentences that tell the user what a plan will do and
 * what deserves their attention, in the vault's language. It sees counts and a few one-line
 * descriptions, never note contents.
 *
 * v1 was told which changes come first but not why, and wrote faithful but generic summaries ("verify
 * all 71 moves"): the eval's judge found every claim backed, yet nothing named for the owner to look
 * at. v2 says how many changes are uncertain, marks the examples as the least certain with their
 * confidence, and asks for those to be named (docs/EVALS.md, "Plan summary").
 */
export const planSummaryV2: Prompt<PlanSummaryInput, PlanSummaryOutput> = {
  id: 'plan-summary',
  version: 2,

  build(input): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          'You summarize a plan that reorganizes a personal knowledge base, for its owner to review before anything changes.',
          `Write in ${languageName(input.language)}, plainly and without hype.`,
          'The summary is two or three sentences: what the plan does overall, and which changes deserve a careful look.',
          'Highlights are up to five short points, most important first: the least certain changes and the warnings, each naming its note or folder.',
          'Say what to look at instead of asking the owner to review everything, and use only numbers given in the facts.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [...planFactLines(input), '', 'Answer with JSON: {"summary": "...", "highlights": ["..."]}'].join('\n'),
      },
    ];
  },

  schema() {
    return z.object({ summary: z.string().trim().min(1).max(600), highlights: z.array(z.string().trim().min(1).max(200)).max(5) });
  },

  maxTokens() {
    return 400;
  },
};

/** The plan's facts as the model sees them; the eval's summary judge checks claims against the same lines. */
export function planFactLines(input: PlanSummaryInput): string[] {
  return [
    `Method: ${input.method}`,
    `Operations: ${input.counts.join(', ')}`,
    `Notes per destination: ${input.destinations.join(', ') || 'none'}`,
    `Less certain changes (below 80 %): ${input.uncertain}`,
    'Least certain changes first:',
    ...input.examples.map((example) => `- ${example}`),
    ...(input.warnings.length > 0 ? ['Warnings:', ...input.warnings.map((warning) => `- ${warning}`)] : []),
  ];
}
