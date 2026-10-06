import * as z from 'zod';
import { type NoteCard, renderCard } from '../../planner/cards';
import type { ChatMessage } from '../types';
import { languageName, type Prompt } from './types';

export const ABSTAIN = 'abstain';

export interface ClassifyTarget {
  id: string;
  description: string;
  layout: 'flat' | 'subfolder-per-item' | 'subfolder-per-topic';
  /** For destinations defined by a kind of note (meetings, daily logs): which notes they take. */
  onlyFor: string | null;
  /** Subfolders in use: existing folders and those already given to notes, to reuse. */
  subfolders: string[];
  /** Titles of notes already placed there. */
  examples: string[];
}

export interface ClassifyNotesInput {
  language: 'en' | 'cs';
  /** Organization method, e.g. "PARA". */
  method: string;
  /** How to tell the destinations apart (from the preset). */
  guidance: string;
  targets: ClassifyTarget[];
  notes: { id: string; card: NoteCard }[];
}

export interface ClassifyNotesOutput {
  notes: { noteId: string; rationale: string; destinationId: string; subfolder: string | null; confidence: number }[];
}

const LAYOUT: Record<ClassifyTarget['layout'], string> = {
  flat: 'flat, no subfolders',
  'subfolder-per-item': 'one subfolder per project or item',
  'subfolder-per-topic': 'one subfolder per topic',
};

/** Excerpt length per note: enough to recognise the subject, ten notes per call. */
const NOTE_CHARS = 400;

/**
 * `classify-notes` v2 (PLAN §7.6, §7.8): files a batch of notes into the charter's destinations.
 * The answer's destination must be one of the ids shown or "abstain", so the model can never
 * invent a folder; abstaining is encouraged over guessing, and the user reviews whatever it
 * proposes. Subfolders reuse one in use when possible.
 *
 * Changes from v1, after the M8 evals: every field is required and the rationale comes first.
 * Under schema-constrained decoding (Ollama), v1's optional subfolder was simply never written,
 * and a rationale written before the decision lets the model reason before it commits. Kind
 * destinations say which notes they take, and confidence gets anchors.
 */
export const classifyNotesV2: Prompt<ClassifyNotesInput, ClassifyNotesOutput> = {
  id: 'classify-notes',
  version: 2,

  build(input): ChatMessage[] {
    const language = languageName(input.language);
    const targets = input.targets.map((target) => {
      const lines = [`- ${target.id}: ${target.description} (${LAYOUT[target.layout]})`];
      if (target.onlyFor) lines.push(`  Only for: ${target.onlyFor}`);
      if (target.subfolders.length > 0) lines.push(`  Subfolders in use: ${target.subfolders.join(', ')}`);
      if (target.examples.length > 0) lines.push(`  Example notes: ${target.examples.join('; ')}`);
      return lines.join('\n');
    });
    const notes = input.notes.map((note) => `### Note ${note.id}\n${renderCard(note.card, NOTE_CHARS, true)}`);
    return [
      {
        role: 'system',
        content: [
          `You file notes into the destinations of a personal knowledge base organized with ${input.method}.`,
          input.guidance,
          'For each note, first write a short rationale, then choose the one destination it belongs to, from the list.',
          'For a destination with subfolders, also give the subfolder: reuse one in use when it fits, otherwise propose a short name of one to four words in the language of the notes. Notes about the same project, area or topic share one subfolder. Use null for flat destinations.',
          'A destination marked "Only for" takes only notes of that kind.',
          `If no destination clearly fits, answer "${ABSTAIN}" instead of guessing.`,
          'Confidence is your probability from 0 to 1 that the destination is right: about 0.6 when two destinations could fit, 0.9 or more only when no other destination could.',
          `Write the rationale in ${language}, in at most 15 words.`,
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          '## Destinations',
          ...targets,
          '',
          '## Notes',
          ...notes,
          '',
          `Answer with JSON: {"notes": [{"noteId": "...", "rationale": "...", "destinationId": "...", "subfolder": "..." or null, "confidence": 0.8}]}, one entry for each note.`,
        ].join('\n'),
      },
    ];
  },

  schema(input) {
    const noteIds = input.notes.map((note) => note.id);
    const destinations = [...input.targets.map((target) => target.id), ABSTAIN];
    return z
      .object({
        notes: z.array(
          z.object({
            // Field order is the order a constrained decoder writes them: reasons before the decision.
            noteId: z.enum(noteIds as [string, ...string[]]),
            rationale: z.string().trim().max(300),
            destinationId: z.enum(destinations as [string, ...string[]]),
            subfolder: z.string().trim().max(80).nullable(),
            confidence: z.number().min(0).max(1),
          }),
        ),
      })
      .superRefine((value, context) => {
        for (const id of noteIds) {
          const count = value.notes.filter((note) => note.noteId === id).length;
          if (count !== 1) context.addIssue({ code: 'custom', message: `Note ${id} must be answered exactly once (found ${count}).`, path: ['notes'] });
        }
      });
  },

  maxTokens(input) {
    return 100 + 90 * input.notes.length;
  },
};
