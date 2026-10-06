import { type ClassifyNotesInput, classifyNotesV2, type ClassifyTarget } from '../ai/prompts/classify-notes.v2';
import { estimateRequest, estimateTokens } from '../ai/budget';
import { runPrompt } from '../ai/prompts/types';
import type { ChatProvider } from '../ai/types';
import { PRESETS, toLang } from '../charter/presets';
import { METHOD_LABELS } from '../model/methods';
import type { Destination } from '../charter/schema';
import type { NoteRecord } from '../model/note';
import { isInFolder } from '../model/paths';
import { type NoteCard, renderCard } from './cards';
import { isKindDestination, type LlmContext, type LlmDecision, type LlmStage, type Placement } from './classify';
import { safeFolderName } from './placement-plan';
import { folderKey } from './subfolders';

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
  /** Ask again about answers whose self-reported confidence falls in this range. */
  secondSample?: { low: number; high: number } | false;
}

/** Self-reports in this range are borderline; above it the model is sure, below it a second ask rarely helps. */
export const SECOND_SAMPLE = { low: 0.4, high: 0.85 };

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
    const sendable = notes.filter((note) => options.cards.has(note.path));
    stats.withheld += notes.length - sendable.length;
    const base = promptBase(context, options.folders);
    const decisions = await ask(sendable, base);

    // A second opinion for borderline answers (PLAN §7.6): the same notes in reverse order land
    // in different batches, so the model sees them in a different context. Agreement is evidence.
    const range = options.secondSample;
    const borderline = range
      ? sendable.filter((note) => {
          const decision = decisions.get(note.path);
          return Boolean(decision?.destination) && (decision?.confidence ?? 0) >= range.low && (decision?.confidence ?? 1) <= range.high;
        })
      : [];
    if (borderline.length > 0) {
      const second = await ask([...borderline].reverse(), base);
      for (const note of borderline) {
        const first = decisions.get(note.path) as LlmDecision;
        const other = second.get(note.path);
        if (other) decisions.set(note.path, { ...first, agreement: other.destination === first.destination });
      }
    }
    return decisions;
  };

  const ask = async (notes: readonly NoteRecord[], base: Omit<ClassifyNotesInput, 'notes'>): Promise<Map<string, LlmDecision>> => {
    const decisions = new Map<string, LlmDecision>();
    for (const batch of batches(notes, base, options.cards, batchSize, options.provider.capabilities.maxContext)) {
      const input: ClassifyNotesInput = { ...base, notes: batch.map((note, i) => ({ id: `n${i + 1}`, card: options.cards.get(note.path) as NoteCard })) };
      const result = await runPrompt(options.provider, classifyNotesV2, input);
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
        // "abstain" is no target, so the note stays undecided.
        const chosen = base.targets.find((t) => t.id === answer.destinationId);
        const subfolder = chosen && chosen.layout !== 'flat' && answer.subfolder ? safeFolderName(answer.subfolder) || null : null;
        const target = chosen && subfolder ? (itemHome(base.targets, chosen, subfolder) ?? chosen) : chosen;
        decisions.set(note.path, {
          destination: target ? target.id : null,
          subfolder,
          confidence: answer.confidence,
          rationale: answer.rationale || 'Suggested by the language model.',
        });
        // Later batches see the subfolders proposed so far, so one project keeps one name.
        if (target && subfolder) offerSubfolder(target, subfolder);
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
  // Room for the subfolders that earlier batches add to the destinations.
  const fixed = estimateRequest({ messages: classifyNotesV2.build({ ...base, notes: [] }) }).input + SUBFOLDER_RESERVE;
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
    targets: context.targets.map((target): ClassifyTarget => {
      const destination = charter.destinations.find((d) => d.id === target.id);
      const result: ClassifyTarget = {
        id: target.id,
        description: target.description,
        layout: target.layout,
        onlyFor: destination && isKindDestination(destination) ? kindText(destination) : null,
        subfolders: [],
        examples: examples(context.placed, target.id),
      };
      if (target.path && target.layout !== 'flat') {
        // Subfolders in use: existing folders, then those given to notes placed so far (a project's
        // hub note names its project before the project's folder exists).
        const given = [...context.placed.values()].filter((p) => p.destination === target.id && p.subfolder).map((p) => p.subfolder as string);
        for (const name of [...childFolders(folders, target.path), ...given.sort()]) offerSubfolder(result, name);
      }
      return result;
    }),
  };
}

/** Subfolders listed per destination: enough to reuse, bounded so the prompt stays small. */
const MAX_SUBFOLDERS = 20;
/** Tokens kept free for subfolder names added between batches (about four tokens each). */
const SUBFOLDER_RESERVE = 100;

function offerSubfolder(target: ClassifyTarget, name: string): void {
  if (target.subfolders.length >= MAX_SUBFOLDERS || target.subfolders.some((existing) => folderKey(existing) === folderKey(name))) return;
  target.subfolders.push(name);
}

/**
 * A project or an area has one folder. When the model names an item's subfolder under another
 * destination (a project's checklist filed as knowledge, a finished project's note under active
 * ones), the note goes where that item lives. The model recognizes what a note belongs to more
 * reliably than how the method sorts it: on the M8 evals it named the right project for most ACE
 * notes it misfiled. Only an unambiguous item counts: in use under exactly one item destination,
 * and not under the one chosen.
 */
function itemHome(targets: readonly ClassifyTarget[], chosen: ClassifyTarget, subfolder: string): ClassifyTarget | null {
  const key = folderKey(subfolder);
  if (chosen.subfolders.some((name) => folderKey(name) === key)) return null;
  const homes = targets.filter((t) => t !== chosen && t.layout === 'subfolder-per-item' && t.subfolders.some((name) => folderKey(name) === key));
  return homes.length === 1 ? (homes[0] as ClassifyTarget) : null;
}

/** Which notes a kind destination takes, in words: its rules test a note type or a dated file name. */
function kindText(destination: Destination): string {
  const types = new Set<string>();
  let dated = false;
  for (const rule of destination.match) {
    if ('equals' in rule) for (const value of Array.isArray(rule.equals) ? rule.equals : [rule.equals]) types.add(String(value));
    else if ('filename' in rule) dated = true;
  }
  const parts = [types.size > 0 ? `notes whose type is ${[...types].join(' or ')}` : '', dated ? `notes with a date in the file name` : ''].filter((part) => part !== '');
  return `${parts.join(', or ')}.`;
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
