import * as z from 'zod';
import type { ChatMessage } from '../types';
import { languageName, type Prompt } from './types';

export interface SubfolderNamingInput {
  language: 'en' | 'cs';
  destination: { id: string; description: string };
  existing: string[];
  proposals: { key: string; name: string; notes: string[] }[];
}

export interface SubfolderNamingOutput {
  folders: { key: string; name: string }[];
}

/**
 * `subfolder-naming` v1 (PLAN §7.6, §7.8): names the new project, area or topic folders a plan
 * would create. Existing folders are shown so the model can send notes into them instead of
 * creating near-duplicates ("Web app" next to "Webapp").
 */
export const subfolderNamingV1: Prompt<SubfolderNamingInput, SubfolderNamingOutput> = {
  id: 'subfolder-naming',
  version: 1,

  build(input): ChatMessage[] {
    const proposals = input.proposals.map((p) => `- ${p.key}: "${p.name}" (notes: ${p.notes.join('; ')})`);
    return [
      {
        role: 'system',
        content: [
          'You name folders in a personal knowledge base.',
          `For each proposed folder give a name of one to four words in ${languageName(input.language)}, in sentence case, that its owner would recognise at a glance.`,
          'If an existing folder means the same thing, answer with its exact name so the notes join it.',
          'Give two proposals the same name only if they really are the same thing.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Destination ${input.destination.id}: ${input.destination.description}`,
          `Existing folders: ${input.existing.length > 0 ? input.existing.join(', ') : 'none'}`,
          '',
          'Proposed folders:',
          ...proposals,
          '',
          'Answer with JSON: {"folders": [{"key": "...", "name": "..."}]}, one entry for each proposal.',
        ].join('\n'),
      },
    ];
  },

  schema(input) {
    const keys = input.proposals.map((p) => p.key);
    return z
      .object({ folders: z.array(z.object({ key: z.enum(keys as [string, ...string[]]), name: z.string().trim().min(1).max(60) })) })
      .superRefine((value, context) => {
        for (const key of keys) {
          const count = value.folders.filter((folder) => folder.key === key).length;
          if (count !== 1) context.addIssue({ code: 'custom', message: `Folder ${key} must be named exactly once (found ${count}).`, path: ['folders'] });
        }
      });
  },

  maxTokens(input) {
    return 60 + 30 * input.proposals.length;
  },
};
