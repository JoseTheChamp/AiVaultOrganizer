import type { ChatProvider } from '../../src/core/ai/types';
import { ApplyRunService } from '../../src/core/apply/run';
import { UndoService } from '../../src/core/apply/undo';
import { validatePlan } from '../../src/core/apply/validate';
import { presetCharter } from '../../src/core/charter/presets';
import type { Neighbor } from '../../src/core/embeddings/top-k';
import type { VaultSnapshot } from '../../src/core/model/note';
import type { Operation } from '../../src/core/model/operation';
import { buildCard, type NoteCard } from '../../src/core/planner/cards';
import { classifyNotes, DEFAULT_KNN, type KnnOptions, WORD_KNN } from '../../src/core/planner/classify';
import { createLlmStage, type LlmStageStats, SECOND_SAMPLE } from '../../src/core/planner/llm-stage';
import { buildPlan } from '../../src/core/planner/plan';
import { charterRoots } from '../../src/core/planner/charter-roots';
import { folderKey, reconcileSubfolders } from '../../src/core/planner/subfolders';
import { applyHarness } from '../../src/core/testing/apply-harness';
import { FIXTURE_METHOD_KEYS, FIXTURE_METHODS, type FixtureMethod, type GroundTruth } from '../fixture/ground-truth';
import { type ClassificationMetrics, classificationMetrics, type Decider, type Prediction, ratio } from '../metrics/classification';

/** Cascade configurations measured, cheapest first; each adds a stage to the one before. */
export const STAGES = ['rules', 'words', 'embeddings', 'llm'] as const;
export type Stage = (typeof STAGES)[number];

export interface StageMetrics extends ClassificationMetrics {
  /** Of the notes placed in the right destination that belong in a subfolder, the share in the right one; null when none do. */
  subfolderAccuracy: number | null;
}

export type ClassificationResults = Record<FixtureMethod, Partial<Record<Stage, StageMetrics>>>;

type Search = (path: string, k: number) => readonly Neighbor[];

export interface ClassificationInput {
  snapshot: VaultSnapshot;
  truth: GroundTruth;
  contents: ReadonlyMap<string, string>;
  words: Search;
  embeddings?: Search;
  chat?: ChatProvider;
}

const DECIDER: Record<string, Decider> = { rule: 'rules', knn: 'knn', llm: 'llm' };

/**
 * Classification per method and per cascade configuration (PLAN §8.2): rules alone, then with kNN
 * over word statistics, kNN over embeddings, and finally the language model on top. Each run is
 * calibrated as the planner would, so ECE measures the confidences the review will show.
 */
export async function classificationTask(input: ClassificationInput, onStats?: (stats: LlmStageStats) => void): Promise<ClassificationResults> {
  const { snapshot, truth } = input;
  const cards = new Map<string, NoteCard>();
  if (input.chat) {
    for (const note of snapshot.notes) {
      const card = buildCard(note, input.contents.get(note.path) ?? '');
      if (card) cards.set(note.path, card);
    }
  }
  const variants: [Stage, Search | undefined, KnnOptions, boolean][] = [
    ['rules', undefined, DEFAULT_KNN, false],
    ['words', input.words, WORD_KNN, false],
  ];
  if (input.embeddings) variants.push(['embeddings', input.embeddings, DEFAULT_KNN, false]);
  if (input.chat) variants.push(['llm', input.embeddings ?? input.words, input.embeddings ? DEFAULT_KNN : WORD_KNN, true]);

  const results = {} as ClassificationResults;
  for (const method of FIXTURE_METHOD_KEYS) {
    const charter = presetCharter(FIXTURE_METHODS[method], truth.language);
    results[method] = {};
    for (const [stage, neighbors, knn, useModel] of variants) {
      const model = useModel && input.chat ? createLlmStage({ provider: input.chat, cards, folders: snapshot.folders, secondSample: SECOND_SAMPLE }) : null;
      const classification = await classifyNotes({ snapshot, charter, charterPath: null, neighbors, ...(model ? { llm: model.stage } : {}) }, knn);
      await reconcileSubfolders(classification, charter, snapshot.folders);
      if (model) onStats?.(model.stats);
      const predictions: Prediction[] = [...classification.placements.values()].map((p) => ({
        path: p.path,
        destination: p.destination,
        confidence: p.confidence,
        decidedBy: p.source ? (DECIDER[p.source] ?? null) : null,
      }));
      const expected = new Map(Object.entries(truth.notes).map(([path, note]) => [path, note.destinations[method].id]));
      let withSubfolder = 0;
      let rightSubfolder = 0;
      for (const placement of classification.placements.values()) {
        const target = truth.notes[placement.path]?.destinations[method];
        if (!target?.subfolder || placement.destination !== target.id) continue;
        withSubfolder++;
        if (placement.subfolder && folderKey(placement.subfolder) === folderKey(target.subfolder)) rightSubfolder++;
      }
      results[method][stage] = { ...classificationMetrics(predictions, expected), subfolderAccuracy: withSubfolder > 0 ? ratio(rightSubfolder, withSubfolder) : null };
    }
  }
  return results;
}

export interface PlanMetrics {
  /** Operations by kind. */
  operations: Record<string, number>;
  /** Validation errors (must be 0). */
  errors: number;
  applied: number;
  failed: number;
  /** Links that stopped resolving (must be 0). */
  brokenLinks: number;
  undoExact: boolean;
  summarySource: 'model' | 'rules';
}

export interface PlanInput {
  snapshot: VaultSnapshot;
  truth: GroundTruth;
  contents: ReadonlyMap<string, string>;
  /** The best similarity available, with its kNN thresholds. */
  neighbors: Search;
  knn: KnnOptions;
  chat?: ChatProvider;
}

/**
 * The whole planner on a fixture with a PARA charter (the M8 definition of done): plan, validate,
 * accept everything, apply through the real executor, check links, undo, check bytes. With the
 * same similarity and model, its classification requests are the PARA ones of the classification
 * task, so one recording serves both.
 */
export async function planTask({ snapshot, truth, contents, neighbors, knn, chat }: PlanInput): Promise<PlanMetrics> {
  const charter = presetCharter('para', truth.language);
  const harness = applyHarness(Object.fromEntries(contents), snapshot.folders);
  const { vault, deps, storage, clock } = harness;
  const original = { contents: vault.contents(), folders: vault.folderPaths() };
  const before = await vault.graph();
  const { plan, summary } = await buildPlan({
    snapshot: await vault.snapshot(),
    charter,
    charterPath: null,
    read: (path) => vault.read(path),
    now: new Date(Date.UTC(2026, 9, 7)),
    neighbors,
    knn,
    cardAges: false,
    ...(chat ? { model: { provider: chat, name: chat.model } } : {}),
  });
  const accepted = { ...plan, operations: plan.operations.map((op): Operation => ({ ...op, status: 'accepted' })) };
  const options = { ignore: charter.ignore, allowedRoots: charterRoots(charter) };
  const errors = validatePlan(accepted, { snapshot: await vault.snapshot(), ...options }).issues.filter((issue) => issue.severity === 'error').length;
  const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(accepted, { pluginVersion: 'eval', ...options });
  const after = await vault.graph();
  const report = outcome.kind === 'ran' ? outcome.report : null;
  await new UndoService(deps).undoLast();
  const operations: Record<string, number> = {};
  for (const op of plan.operations) operations[op.kind === 'flag' ? `flag:${op.issue}` : op.kind] = (operations[op.kind === 'flag' ? `flag:${op.issue}` : op.kind] ?? 0) + 1;
  return {
    operations,
    errors,
    applied: report?.applied ?? 0,
    failed: report?.failed ?? plan.operations.length,
    brokenLinks: Math.max(0, after.unresolvedCount - before.unresolvedCount) + Math.max(0, before.edges.length - after.edges.length),
    undoExact: JSON.stringify(vault.contents()) === JSON.stringify(original.contents) && JSON.stringify(vault.folderPaths()) === JSON.stringify(original.folders),
    summarySource: summary.source,
  };
}
