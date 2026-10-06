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
  /** A few operations as one-line descriptions. */
  examples: string[];
  warnings: string[];
}

export interface PlanSummaryOutput {
  summary: string;
  highlights: string[];
}

/**
 * `plan-summary` v1 (PLAN §7.8): two or three sentences that tell the user what a plan will do and
 * what deserves their attention, in the vault's language. It sees counts and a few one-line
 * descriptions, never note contents.
 */
export const planSummaryV1: Prompt<PlanSummaryInput, PlanSummaryOutput> = {
  id: 'plan-summary',
  version: 1,

  build(input): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          'You summarize a plan that reorganizes a personal knowledge base, for its owner to review before anything changes.',
          `Write in ${languageName(input.language)}, plainly and without hype.`,
          'The summary is two or three sentences: what the plan does overall, and what deserves a careful look.',
          'Highlights are up to five short points the owner should check, most important first.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Method: ${input.method}`,
          `Operations: ${input.counts.join(', ')}`,
          `Notes per destination: ${input.destinations.join(', ') || 'none'}`,
          'Examples:',
          ...input.examples.map((example) => `- ${example}`),
          ...(input.warnings.length > 0 ? ['Warnings:', ...input.warnings.map((warning) => `- ${warning}`)] : []),
          '',
          'Answer with JSON: {"summary": "...", "highlights": ["..."]}',
        ].join('\n'),
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
