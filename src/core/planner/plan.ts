import { classifyNotesV2 } from '../ai/prompts/classify-notes.v2';
import { planSummaryV1 } from '../ai/prompts/plan-summary.v1';
import { subfolderNamingV1 } from '../ai/prompts/subfolder-naming.v1';
import type { ChatProvider } from '../ai/types';
import { toLang } from '../charter/presets';
import type { Charter } from '../charter/schema';
import type { Neighbor } from '../embeddings/top-k';
import type { VaultSnapshot } from '../model/note';
import { createOperation, type Operation, type OperationIntent } from '../model/operation';
import { ancestorFolders, joinPath } from '../model/paths';
import { createPlan, type Plan } from '../model/plan';
import { buildCard, type NoteCard } from './cards';
import { charterRoots } from './charter-roots';
import { type Classification, classifyNotes, type KnnOptions } from './classify';
import { createLlmStage, type LlmStageStats, SECOND_SAMPLE } from './llm-stage';
import { mocOperations } from './mocs';
import { tagOperations, propertyOperations } from './normalize';
import { placementOperations } from './placement-plan';
import { queryBreakageOperations } from './query-breakage';
import { type LinkSuggestion, relatedLinkOperations } from './related-links';
import { createSubfolderNamer, type NamerStats, reconcileSubfolders, type SubfolderReport } from './subfolders';
import { type PlanSummary, summarizePlan } from './summary';

export interface PlannerInput {
  snapshot: VaultSnapshot;
  charter: Charter;
  charterPath: string | null;
  read: (path: string) => Promise<string>;
  now: Date;
  /** Similarity search over the notes (words or embeddings): enables kNN. */
  neighbors?: (path: string, k: number) => readonly Neighbor[];
  /** kNN thresholds for the similarity behind `neighbors`: DEFAULT_KNN (embeddings) or WORD_KNN. */
  knn?: KnnOptions;
  /** A language model: classifies what cheaper stages could not, names subfolders, summarizes. */
  model?: { provider: ChatProvider; name: string; embedding?: string };
  /** Accepted link suggestions to include. */
  links?: readonly LinkSuggestion[];
  /** Show the model how recently notes changed (off for replayed evals, where file times vary). */
  cardAges?: boolean;
  /** Also create the charter's folders that do not exist yet, even with no note to move there. */
  createDestinationFolders?: boolean;
}

export interface PlannerResult {
  plan: Plan;
  classification: Classification;
  summary: PlanSummary;
  subfolders: SubfolderReport;
  model?: { classification: LlmStageStats; naming: NamerStats };
}

/**
 * The full re-organization plan (PLAN §2, §7.6): classify every note with the cascade, settle
 * subfolder names, move notes into place, normalize properties and tags, add accepted related
 * links, update maps of content, flag queries the moves would break, and summarize it all for the
 * review. Nothing here writes to the vault; the plan goes through review, backup and the apply
 * path like any other (invariant 2).
 */
export async function buildPlan(input: PlannerInput): Promise<PlannerResult> {
  const { snapshot, charter } = input;
  const contents = new Map<string, string>();
  const read = async (path: string): Promise<string> => {
    let content = contents.get(path);
    if (content === undefined) contents.set(path, (content = await input.read(path)));
    return content;
  };

  let model: PlannerResult['model'];
  let llmStage;
  let namer;
  if (input.model) {
    const cards = new Map<string, NoteCard>();
    for (const note of snapshot.notes) {
      const card = buildCard(note, await read(note.path), undefined, input.cardAges === false ? {} : { now: input.now.getTime() });
      if (card) cards.set(note.path, card);
    }
    const stage = createLlmStage({ provider: input.model.provider, cards, folders: snapshot.folders, secondSample: SECOND_SAMPLE });
    const naming = createSubfolderNamer(input.model.provider, toLang(charter.language));
    llmStage = stage.stage;
    namer = naming.namer;
    model = { classification: stage.stats, naming: naming.stats };
  }

  const classification = await classifyNotes({ snapshot, charter, charterPath: input.charterPath, neighbors: input.neighbors, llm: llmStage }, input.knn);
  const subfolders = await reconcileSubfolders(classification, charter, snapshot.folders, namer);
  const placed = placementOperations(classification, snapshot, charter);
  const skeleton = input.createDestinationFolders ? destinationFolders(charter, snapshot, placed.operations) : [];
  const moves = placed.operations.filter((op): op is Extract<Operation, { kind: 'move' }> => op.kind === 'move');

  const skipped = new Set(classification.skipped);
  const notes = snapshot.notes.filter((note) => !skipped.has(note.path));
  const edits = followMoves(
    [...propertyOperations(notes, charter), ...tagOperations(notes, charter), ...(input.links ? relatedLinkOperations(input.links, snapshot, charter) : [])],
    moves,
  );
  const sofar = [...skeleton, ...placed.operations, ...edits];
  const mocs = await mocOperations({ snapshot, charter, operations: sofar, read });
  const queries = await queryBreakageOperations(snapshot, sofar, read);

  const stamp = input.now.toISOString().replace(/[-:.]/g, '').slice(0, 15);
  const plan = createPlan({
    id: `plan-${stamp}`,
    createdAt: input.now.toISOString(),
    charterRevision: charter.revision,
    operations: [...sofar, ...mocs, ...queries],
    warnings: placed.warnings,
    promptVersions: input.model ? Object.fromEntries([classifyNotesV2, subfolderNamingV1, planSummaryV1].map((prompt) => [prompt.id, prompt.version])) : {},
    models: input.model ? { chat: input.model.name, ...(input.model.embedding ? { embedding: input.model.embedding } : {}) } : {},
  });
  const summary = await summarizePlan(plan, charter, input.model?.provider);
  return { plan, classification, summary, subfolders, ...(model ? { model } : {}) };
}

/** The charter's folders (with their parents) that neither exist nor are created by the moves. */
function destinationFolders(charter: Charter, snapshot: VaultSnapshot, operations: readonly Operation[]): Operation[] {
  const known = new Set([...snapshot.folders, ...operations.flatMap((op) => (op.kind === 'createFolder' ? [op.path] : []))].map((folder) => folder.toLowerCase()));
  const missing = new Set<string>();
  for (const root of charterRoots(charter)) {
    if (root === '') continue;
    for (const folder of [...ancestorFolders(joinPath(root, 'x')), root]) if (!known.has(folder.toLowerCase())) missing.add(folder);
  }
  return [...missing].sort().map((path) => createOperation({ kind: 'createFolder', path }, { source: 'rule', confidence: 1, rationale: 'The charter defines this folder.' }));
}

/**
 * Edits planned for a note that also moves must name the note's new path and wait for the move:
 * moves run first (PLAN §5.5), and if a move fails, the edits that depend on it are skipped. The
 * precondition keeps the original path; preconditions are checked before anything moves.
 */
export function followMoves(operations: readonly Operation[], moves: readonly Extract<Operation, { kind: 'move' }>[]): Operation[] {
  const byFrom = new Map(moves.map((move) => [move.from, move]));
  const ids = new Map<string, string>();
  const retargeted = operations.map((op) => {
    const dependencies = new Set(op.dependsOn ?? []);
    let moved = false;
    const follow = (path: string): string => {
      const move = byFrom.get(path);
      if (!move) return path;
      moved = true;
      dependencies.add(move.id);
      return move.to;
    };
    let intent: OperationIntent | null = null;
    switch (op.kind) {
      case 'setProperty':
        intent = { kind: op.kind, path: follow(op.path), key: op.key, value: op.value };
        break;
      case 'renameProperty':
        intent = { kind: op.kind, path: follow(op.path), from: op.from, to: op.to };
        break;
      case 'addTags':
        intent = { kind: op.kind, path: follow(op.path), tags: op.tags };
        break;
      case 'replaceTag':
        intent = { kind: op.kind, path: follow(op.path), from: op.from, to: op.to };
        break;
      case 'addRelatedLinks':
        intent = { kind: op.kind, path: follow(op.path), heading: op.heading, targets: op.targets.map(follow) };
        break;
      case 'updateGeneratedSection':
        intent = { kind: op.kind, path: follow(op.path), sectionId: op.sectionId, content: op.content };
        break;
      // Moves and folders define the new layout, new notes are created where they belong, and flags
      // point at where a note is now.
      case 'move':
      case 'createFolder':
      case 'createNote':
      case 'updateCharterRules':
      case 'flag':
        return op;
    }
    if (!moved) return op;
    const meta = { rationale: op.rationale, confidence: op.confidence, source: op.source, status: op.status, precondition: op.precondition };
    const next = createOperation(intent, dependencies.size > 0 ? { ...meta, dependsOn: [...dependencies] } : meta);
    ids.set(op.id, next.id);
    return next;
  });
  // Dependencies between retargeted edits (a value fix after a rename) follow the new ids.
  return retargeted.map((op) => (op.dependsOn?.some((id) => ids.has(id)) ? { ...op, dependsOn: op.dependsOn.map((id) => ids.get(id) ?? id) } : op));
}
