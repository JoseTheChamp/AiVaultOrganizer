import type { Charter } from '../charter/schema';
import type { VaultSnapshot } from '../model/note';
import type { Operation } from '../model/operation';
import { isInFolder } from '../model/paths';
import type { Plan } from '../model/plan';
import { calibrate } from './calibrate';
import { type Classification, classifyNotes, isKindDestination, type KnnOptions, type KnnSignal, knnDecides, knnVote, type NeighborLookup, type Placement } from './classify';
import { placementOperations } from './placement-plan';

export interface RerankInput {
  /** The plan with the reviewer's decisions as statuses. */
  plan: Plan;
  snapshot: VaultSnapshot;
  charter: Charter;
  charterPath: string | null;
  neighbors: NeighborLookup;
  knn: KnnOptions;
}

export interface RerankResult {
  plan: Plan;
  /** Undecided moves whose confidence changed. */
  rescored: number;
  /** Notes flagged as ambiguous that now have a proposed place. */
  placed: number;
}

type Anchor = Pick<Placement, 'destination' | 'subfolder'>;

/**
 * Learns from the review (PLAN §7.6, "human-in-the-loop"): accepted moves join the rule-placed
 * notes as anchors, and a rejected move rules that destination out for its note. kNN then votes
 * again for what is still undecided, without any model call:
 *
 * - an undecided move the new anchors agree with gains confidence, one they contradict loses it
 *   (decisions by rules are certain and stay as they are);
 * - a note flagged as ambiguous gets a proposed move when the vote is now strong enough.
 *
 * Rationales say what changed, so the reviewer sees why a row moved.
 */
export async function rerankFromDecisions(input: RerankInput): Promise<RerankResult> {
  const { plan, charter, snapshot } = input;
  const rules = await classifyNotes({ snapshot, charter, charterPath: input.charterPath });
  const anchors = new Map<string, Anchor>();
  for (const [path, placement] of rules.placements) if (placement.destination !== null) anchors.set(path, placement);
  const rejected = new Map<string, Set<string>>();
  for (const op of plan.operations) {
    if (op.kind !== 'move') continue;
    const target = destinationOf(op.to, charter);
    if (!target) continue;
    if (op.status === 'accepted') anchors.set(op.from, target);
    if (op.status === 'rejected') rejected.set(op.from, new Set([...(rejected.get(op.from) ?? []), target.destination as string]));
  }
  const kinds = new Set(charter.destinations.filter(isKindDestination).map((d) => d.id));
  const labelOf = (id: string) => charter.destinations.find((d) => d.id === id)?.path ?? id;

  let rescored = 0;
  let placed = 0;
  const operations: Operation[] = [];
  const folders = new Set(plan.operations.flatMap((op) => (op.kind === 'createFolder' ? [op.path.toLowerCase()] : [])));
  for (const op of plan.operations) {
    if (op.status !== 'pending') {
      operations.push(op);
      continue;
    }
    if (op.kind === 'move' && (op.source === 'knn' || op.source === 'llm')) {
      const target = destinationOf(op.to, charter);
      const signal = target ? await knnVote(op.from, input.neighbors, anchors, input.knn, kinds) : null;
      const next = target && signal ? rescore(op, target.destination as string, signal, input.knn, labelOf) : null;
      if (next) rescored++;
      operations.push(next ?? op);
      continue;
    }
    if (op.kind === 'flag' && op.issue === 'ambiguous') {
      const signal = await knnVote(op.path, input.neighbors, anchors, input.knn, kinds);
      if (knnDecides(signal, input.knn) && !rejected.get(op.path)?.has(signal.destination)) {
        const proposal = propose(op.path, signal, snapshot, charter, rules, labelOf).filter((proposed) => proposed.kind !== 'createFolder' || !folders.has(proposed.path.toLowerCase()));
        if (proposal.some((proposed) => proposed.kind === 'move')) {
          for (const proposed of proposal) if (proposed.kind === 'createFolder') folders.add(proposed.path.toLowerCase());
          operations.push(...proposal);
          placed++;
          continue;
        }
      }
    }
    operations.push(op);
  }
  return { plan: { ...plan, operations }, rescored, placed };
}

/** A move with its confidence moved towards what the anchors now say, or null if it stays. */
function rescore(op: Extract<Operation, { kind: 'move' }>, destination: string, signal: KnnSignal, knn: KnnOptions, labelOf: (id: string) => string): Operation | null {
  const agreeing = signal.destination === destination;
  if (!agreeing && !knnDecides(signal, knn)) return null;
  const knnConfidence = calibrate({ path: op.from, destination: signal.destination, subfolder: signal.subfolder, confidence: signal.share, source: 'knn', rationale: '', signals: { knn: signal } });
  // Agreement can only add confidence; a confident vote elsewhere caps it at the chance that vote is wrong.
  const confidence = agreeing ? Math.max(op.confidence, knnConfidence) : Math.min(op.confidence, 1 - knnConfidence);
  if (Math.abs(confidence - op.confidence) < 0.005) return null;
  const why = agreeing
    ? `Your decisions agree: ${signal.supporters} similar notes are in ${labelOf(destination)}.`
    : `But ${signal.supporters} similar notes you placed are in ${labelOf(signal.destination)}.`;
  return { ...op, confidence, rationale: `${op.rationale} ${why}`.trim() };
}

/** The move (and folders) kNN now proposes for an ambiguous note. */
function propose(path: string, signal: KnnSignal, snapshot: VaultSnapshot, charter: Charter, rules: Classification, labelOf: (id: string) => string): Operation[] {
  const destination = charter.destinations.find((d) => d.id === signal.destination);
  const placement: Placement = {
    path,
    destination: signal.destination,
    subfolder: destination && destination.layout !== 'flat' ? signal.subfolder : null,
    confidence: signal.share,
    source: 'knn',
    rationale: `Learned from your decisions: ${signal.supporters} similar notes are in ${labelOf(signal.destination)}.`,
    signals: { knn: signal },
  };
  placement.confidence = calibrate(placement);
  return placementOperations({ ...rules, placements: new Map([[path, placement]]) }, snapshot, charter).operations;
}

/** The destination whose folder holds a path (the deepest, if folders nest), with its subfolder. */
function destinationOf(path: string, charter: Charter): Anchor | null {
  const matches = charter.destinations.filter((d) => d.path !== undefined && isInFolder(path, d.path)).sort((a, b) => (b.path as string).length - (a.path as string).length);
  const destination = matches[0];
  if (!destination?.path) return null;
  const rest = path.slice(destination.path.length + 1).split('/');
  return { destination: destination.id, subfolder: destination.layout !== 'flat' && rest.length > 1 ? (rest[0] ?? null) : null };
}
