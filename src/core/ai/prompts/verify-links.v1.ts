import * as z from 'zod';
import { type NoteCard, renderCard } from '../../planner/cards';
import type { ChatMessage } from '../types';
import { languageName, type Prompt } from './types';

export interface VerifyLinksInput {
  language: 'en' | 'cs';
  pairs: { id: string; a: NoteCard; b: NoteCard }[];
}

export interface VerifyLinksOutput {
  pairs: { pairId: string; relevant: boolean; strength: number; reason: string }[];
}

/** Excerpt length per note: two notes per pair, several pairs per call. */
const NOTE_CHARS = 240;

/**
 * `verify-links` v1 (PLAN §7.5, §7.8): decides which suggested links a careful author would add.
 * Similarity finds notes on the same subject; this asks whether one note actually helps when
 * reading the other. The reason is shown in the review, so it is short and in the vault language.
 */
export const verifyLinksV1: Prompt<VerifyLinksInput, VerifyLinksOutput> = {
  id: 'verify-links',
  version: 1,

  build(input): ChatMessage[] {
    const pairs = input.pairs.map((pair) =>
      [`## Pair ${pair.id}`, 'Note A:', indent(renderCard(pair.a, NOTE_CHARS)), 'Note B:', indent(renderCard(pair.b, NOTE_CHARS))].join('\n'),
    );
    return [
      {
        role: 'system',
        content: [
          'You decide whether two notes from a personal knowledge base should link to each other.',
          'A link is worth adding when someone reading one note would want to open the other: they belong to the same project or area, one explains, continues or applies the other, or they are about the same specific subject.',
          'Notes that only share a broad theme or a common word are not related.',
          'For every pair answer: relevant (true or false), strength (1 loosely related, 2 related, 3 closely related) and a reason of at most 15 words.',
          `Write the reasons in ${languageName(input.language)}.`,
        ].join(' '),
      },
      {
        role: 'user',
        content: `${pairs.join('\n\n')}\n\nAnswer with JSON: {"pairs": [{"pairId": "...", "relevant": true, "strength": 2, "reason": "..."}]}, one entry for each pair.`,
      },
    ];
  },

  schema(input) {
    const ids = input.pairs.map((pair) => pair.id);
    return z
      .object({
        pairs: z.array(
          z.object({
            pairId: z.enum(ids as [string, ...string[]]),
            relevant: z.boolean(),
            strength: z.number().int().min(1).max(3),
            reason: z.string().trim().min(1).max(200),
          }),
        ),
      })
      .superRefine((value, context) => {
        for (const id of ids) {
          const count = value.pairs.filter((pair) => pair.pairId === id).length;
          if (count !== 1) context.addIssue({ code: 'custom', message: `Pair ${id} must be answered exactly once (found ${count}).`, path: ['pairs'] });
        }
      });
  },

  maxTokens(input) {
    return 80 + 70 * input.pairs.length;
  },
};

function indent(text: string): string {
  return text.replace(/^/gm, '  ');
}
