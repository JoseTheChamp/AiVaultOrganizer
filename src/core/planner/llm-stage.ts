import { ABSTAIN, type ClassifyNotesInput, classifyNotesV1, type ClassifyTarget } from '../ai/prompts/classify-notes.v1';
import { estimateRequest, estimateTokens } from '../ai/budget';
import { runPrompt } from '../ai/prompts/types';
import type { ChatProvider } from '../ai/types';
import { PRESETS, toLang } from '../charter/presets';
import { METHOD_LABELS } from '../model/methods';
import type { NoteRecord } from '../model/note';
import { isInFolder } from '../model/paths';
import { type NoteCard, renderCard } from './cards';
import type { LlmContext, LlmDecision, LlmStage, Placement } from './classify';
import { safeFolderName } from './placement-plan';

export interface LlmStageStats {
  calls: number;
  /** Batches whose answer stayed invalid after the repair round, or failed outright. */
  failures: number;
  repaired: number;
  inputTokens: number;
  outputTokens: number;
  /** Notes with no card (private notes): never sent. */
  withheld: number;
}

export interface LlmStageOptions {
  provider: ChatProvider;
  /** Cards for every note that may go to a model; notes without one are never sent. */
  cards: ReadonlyMap<string, NoteCard>;
  /** Every folder in the vault, to offer existing subfolders for reuse. */
  folders: readonly string[];
  batchSize?: number;
}

/** A model stage for the cascade, and counters for its cost and failures. */
export interface ModelStage {
  stage: LlmStage;
  stats: LlmStageStats;
}

const GENERIC_GUIDANCE = 'Place each note where its owner would look for it first.';

/**
 * The language-model stage of the classification cascade (PLAN §7.6 step 3), built on the
 * `classify-notes` prompt: batches of note cards, the charter's destinations with existing
 * subfolders and example notes, and the preset's guidance. Private notes are withheld; a batch
 * that fails leaves its notes undecided (they are flagged for the user, never guessed).
 */
export function createLlmStage(options: LlmStageOptions): ModelStage {
  const stats: LlmStageStats = { calls: 0, failures: 0, repaired: 0, inputTokens: 0, outputTokens: 0, withheld: 0 };
  const batchSize = options.batchSize ?? 10;

  const stage: LlmStage = async (notes, context) => {
    const decisions = new Map<string, LlmDecision>();
    const sendable = notes.filter((note) => options.cards.has(note.path));
    stats.withheld += notes.length - sendable.length;
    const base = promptBase(context, options.folders);
    for (const batch of batches(sendable, base, options.cards, batchSize, options.provider.capabilities.maxContext)) {
      const input: ClassifyNotesInput = { ...base, notes: batch.map((note, i) => ({ id: `n${i + 1}`, card: options.cards.get(note.path) as NoteCard })) };
      const result = await runPrompt(options.provider, classifyNotesV1, input);
      stats.calls += result.ok ? result.value.attempts : result.error.attempts;
      if (!result.ok) {
        stats.failures++;
        continue;
      }
      if (result.value.repaired) stats.repaired++;
      stats.inputTokens += result.value.response.usage.inputTokens;
      stats.outputTokens += result.value.response.usage.outputTokens;
      const byId = new Map(result.value.value.notes.map((answer) => [answer.noteId, answer]));
      batch.forEach((note: NoteRecord, i) => {
        const answer = byId.get(`n${i + 1}`);
        if (!answer) return;
        const target = base.targets.find((t) => t.id === answer.destinationId);
        const subfolder = target && target.layout !== 'flat' && answer.subfolder ? safeFolderName(answer.subfolder) || null : null;
        decisions.set(note.path, {
          destination: answer.destinationId === ABSTAIN ? null : answer.destinationId,
          subfolder,
          confidence: answer.confidence,
          rationale: answer.rationale || 'Suggested by the language model.',
        });
      });
    }
    return decisions;
  };
  return { stage, stats };
}

/**
 * Splits notes into batches that fit the model's context window with room for the answer. Local
 * servers often run small windows (Ollama defaults to 4,096 tokens) and silently cut an
 * oversized prompt from the start, dropping the instructions; a live run lost a whole batch that
 * way. The estimate is pessimistic, so a batch stays inside the window.
 */
function batches(notes: readonly NoteRecord[], base: Omit<ClassifyNotesInput, 'notes'>, cards: ReadonlyMap<string, NoteCard>, maxNotes: number, contextTokens: number): NoteRecord[][] {
  const fixed = estimateRequest({ messages: classifyNotesV1.build({ ...base, notes: [] }) }).input;
  const budget = Math.max(512, Math.floor(contextTokens * 0.9) - fixed);
  const result: NoteRecord[][] = [];
  let current: NoteRecord[] = [];
  let used = 0;
  for (const note of notes) {
    const card = cards.get(note.path) as NoteCard;
    // The note's share of the prompt, plus the answer it will get.
    const cost = estimateTokens(`### Note n10\n${renderCard(card, 400, true)}`) + 90;
    if (current.length > 0 && (current.length >= maxNotes || used + cost > budget)) {
      result.push(current);
      current = [];
      used = 0;
    }
    current.push(note);
    used += cost;
  }
  if (current.length > 0) result.push(current);
  return result;
}

/** Everything in the prompt except the notes: method, guidance and destinations. */
function promptBase(context: LlmContext, folders: readonly string[]): Omit<ClassifyNotesInput, 'notes'> {
  const { charter } = context;
  const preset = charter.preset === 'custom' ? null : PRESETS[charter.preset];
  return {
    language: toLang(charter.language),
    method: preset ? METHOD_LABELS[charter.preset as keyof typeof METHOD_LABELS] : 'its own system',
    guidance: preset?.guidance ?? GENERIC_GUIDANCE,
    targets: context.targets.map((target): ClassifyTarget => ({
      id: target.id,
      description: target.description,
      layout: target.layout,
      subfolders: target.path && target.layout !== 'flat' ? childFolders(folders, target.path).slice(0, 15) : [],
      examples: examples(context.placed, target.id),
    })),
  };
}

function childFolders(folders: readonly string[], parent: string): string[] {
  return folders
    .filter((folder) => isInFolder(folder, parent) && folder !== parent && !folder.slice(parent.length + 1).includes('/'))
    .map((folder) => folder.slice(parent.length + 1))
    .sort();
}

/** Two notes already placed in a destination, rule-placed first: they show what belongs there. */
function examples(placed: ReadonlyMap<string, Placement>, destination: string): string[] {
  return [...placed.values()]
    .filter((placement) => placement.destination === destination)
    .sort((a, b) => Number(b.source === 'rule') - Number(a.source === 'rule') || (a.path < b.path ? -1 : 1))
    .slice(0, 2)
    .map((placement) => placement.path.slice(placement.path.lastIndexOf('/') + 1).replace(/\.md$/i, ''));
}
