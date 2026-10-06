import { planSummaryV1 } from '../ai/prompts/plan-summary.v1';
import { subfolderNamingV1 } from '../ai/prompts/subfolder-naming.v1';
import { estimatePrompt } from '../ai/prompts/types';
import { toLang } from '../charter/presets';
import type { Charter } from '../charter/schema';
import type { VaultSnapshot } from '../model/note';
import type { NoteCard } from './cards';
import type { Classification } from './classify';
import { estimateLlmStage, SECOND_SAMPLE, type StageEstimate } from './llm-stage';

export interface PlanRunInput {
  snapshot: VaultSnapshot;
  charter: Charter;
  /** The cascade's result without a model: what rules and similar notes already decided. */
  classification: Classification;
  /** Cards of every note that may go to a model (private notes have none). */
  cards: ReadonlyMap<string, NoteCard>;
  folders: readonly string[];
  /** The model's context window, which decides the batch sizes. */
  maxContext: number;
}

/** What planning with a model would send and cost (PLAN §2.1 step 5, §7.10), as ranges. */
export type PlanRunEstimate = StageEstimate;

/** A typical subfolder-naming request: ten proposed names with a few notes each. */
const NAMING_SAMPLE = {
  destination: { id: 'projects', description: 'Active projects with a clear goal and an end.' },
  existing: ['Website relaunch', 'Thesis'],
  proposals: Array.from({ length: 10 }, (_, i) => ({ key: `f${i + 1}`, name: `Proposed folder ${i + 1}`, notes: ['A note title', 'Another note title', 'A third note title'] })),
};

/** A typical summary request: the facts are short lists. */
const SUMMARY_SAMPLE = {
  method: 'PARA',
  counts: ['new folders: 12', 'moves: 140', 'property renames: 30', 'flags for you to look at: 9'],
  destinations: ['1 Projects: 40', '2 Areas: 35', '3 Resources: 60', '4 Archive: 5'],
  examples: Array.from({ length: 8 }, () => 'Move "A note title.md" to "1 Projects/A project/A note title.md"'),
  warnings: ['9 notes could not be placed with confidence.'],
};

/**
 * Estimates a planning run with a model before anything is sent: the classification of the notes
 * rules and similar notes left open (with every answer possibly asked twice), at most one
 * subfolder-naming call per destination with subfolders, and the summary. Upper bounds are
 * deliberately pessimistic.
 */
export function estimatePlanRun(input: PlanRunInput): PlanRunEstimate {
  const { classification, charter } = input;
  const open = input.snapshot.notes.filter((note) => classification.placements.get(note.path)?.destination === null);
  const placed = new Map([...classification.placements].filter(([, placement]) => placement.destination !== null));
  const stage = estimateLlmStage(
    { cards: input.cards, folders: input.folders, secondSample: SECOND_SAMPLE, maxContext: input.maxContext },
    open,
    { charter, targets: classification.targets, placed },
  );
  if (stage.notes === 0) return stage;

  const language = toLang(charter.language);
  const naming = estimatePrompt(subfolderNamingV1, { language, ...NAMING_SAMPLE });
  const summary = estimatePrompt(planSummaryV1, { language, ...SUMMARY_SAMPLE });
  const namingCalls = charter.destinations.filter((destination) => destination.path && destination.layout !== 'flat').length;
  const extra = { calls: namingCalls + 1, input: namingCalls * naming.input + summary.input, output: namingCalls * naming.output + summary.output };
  return {
    ...stage,
    // The summary always runs; naming only when new subfolders are proposed.
    calls: { min: stage.calls.min + 1, max: stage.calls.max + extra.calls },
    inputTokens: { min: stage.inputTokens.min + summary.input, max: stage.inputTokens.max + extra.input },
    outputTokens: { min: stage.outputTokens.min + summary.output, max: stage.outputTokens.max + extra.output },
  };
}
