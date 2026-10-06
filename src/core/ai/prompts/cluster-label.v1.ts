import * as z from 'zod';
import { type NoteCard, renderCard } from '../../planner/cards';
import type { ChatMessage } from '../types';
import { languageName, type Prompt } from './types';

export interface ClusterLabelInput {
  language: 'en' | 'cs';
  groups: {
    /** Short id the model answers with, e.g. `g1`. */
    id: string;
    keywords: string[];
    /** A few representative notes (closest to the cluster centre). */
    samples: NoteCard[];
  }[];
}

export interface ClusterLabelOutput {
  labels: { groupId: string; label: string; description: string }[];
}

/** Excerpt length per sample: enough for the gist, cheap for five notes a group. */
const SAMPLE_CHARS = 280;

/**
 * `cluster-label` v1 (PLAN §7.8): names groups of notes found by clustering, in the vault's
 * language, from their keywords and a few sample notes. One call labels several groups; the schema
 * only accepts the group ids it was shown, each exactly once.
 */
export const clusterLabelV1: Prompt<ClusterLabelInput, ClusterLabelOutput> = {
  id: 'cluster-label',
  version: 1,

  build(input): ChatMessage[] {
    const language = languageName(input.language);
    const groups = input.groups.map((group) =>
      [`## Group ${group.id}`, `Keywords: ${group.keywords.join(', ')}`, 'Sample notes:', ...group.samples.map((card) => renderCard(card, SAMPLE_CHARS).replace(/^/gm, '  '))].join('\n'),
    );
    return [
      {
        role: 'system',
        content: [
          'You name groups of notes from a personal knowledge base.',
          'For each group, give a label of one to four words that its owner could use as a topic or folder name, and one sentence describing what the notes are about.',
          `Write both in ${language}. Use sentence case and no emoji.`,
          'Base them only on the keywords and sample notes. If a group mixes subjects, name what most notes share.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `${groups.join('\n\n')}\n\nAnswer with JSON: {"labels": [{"groupId": "...", "label": "...", "description": "..."}]}, one entry for each group.`,
      },
    ];
  },

  schema(input) {
    const ids = input.groups.map((group) => group.id);
    return z
      .object({
        labels: z.array(
          z.object({
            groupId: z.enum(ids as [string, ...string[]]),
            label: z.string().trim().min(1).max(60),
            description: z.string().trim().min(1).max(300),
          }),
        ),
      })
      .superRefine((value, context) => {
        const seen = value.labels.map((label) => label.groupId);
        for (const id of ids) {
          const count = seen.filter((groupId) => groupId === id).length;
          if (count !== 1) context.addIssue({ code: 'custom', message: `Group ${id} must have exactly one label (found ${count}).`, path: ['labels'] });
        }
      });
  },

  maxTokens(input) {
    return 120 + 90 * input.groups.length;
  },
};
