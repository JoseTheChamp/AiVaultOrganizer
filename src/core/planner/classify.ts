import type { Charter, Destination } from '../charter/schema';
import { RuleEngine } from '../drift/rules';
import type { Neighbor } from '../embeddings/top-k';
import type { NoteRecord, VaultSnapshot } from '../model/note';
import { isInFolder } from '../model/paths';
import { type CalibrationOptions, calibrateAll, DEFAULT_CALIBRATION } from './calibrate';

/** Pseudo-destination of properties mode: the note stays in the vault root (PLAN §4, Flat + categories). */
export const ROOT = 'root';
/** Pseudo-destination for daily notes, which live in the charter's daily folder. */
export const DAILY = 'daily';

export type PlacementSource = 'rule' | 'knn' | 'llm';

/** Where a note should go and why, as decided by one stage of the cascade (PLAN §7.6). */
export interface Placement {
  path: string;
  /** Destination id (or `root` / `daily`); null when every stage abstained. */
  destination: string | null;
  /** Subfolder for item and topic layouts, when known. */
  subfolder: string | null;
  /** 0..1; calibrated in a later step. */
  confidence: number;
  source: PlacementSource | null;
  rationale: string;
  signals: Signals;
}

/** Evidence behind a placement, kept for calibration and for the review. */
export interface Signals {
  rule?: string;
  /** The note already sits in this destination's folder. */
  inPlace?: boolean;
  knn?: KnnSignal;
  llm?: LlmDecision;
}

export interface KnnSignal {
  destination: string;
  /** Share of the neighbours' similarity mass that votes for `destination`. */
  share: number;
  /** Similarity of the closest anchor. */
  similarity: number;
  /** Anchors that voted for `destination`. */
  supporters: number;
  subfolder: string | null;
  neighbors: string[];
}

export interface LlmDecision {
  destination: string | null;
  subfolder: string | null;
  confidence: number;
  rationale: string;
  /** Set when a second sample was asked for: whether it agreed. */
  agreement?: boolean;
}

/** A destination the classifier can choose, as the model sees it. */
export interface Target {
  id: string;
  description: string;
  path: string | null;
  layout: Destination['layout'];
}

export interface LlmContext {
  charter: Charter;
  targets: Target[];
  /** Notes placed so far, usable as examples. */
  placed: ReadonlyMap<string, Placement>;
}

/** The language-model stage: decides the notes the cheaper stages could not. */
export type LlmStage = (notes: readonly NoteRecord[], context: LlmContext) => Promise<Map<string, LlmDecision>>;

/** The `k` notes most similar to a note, best first: synchronous in evals, a worker query in Obsidian. */
export type NeighborLookup = (path: string, k: number) => readonly Neighbor[] | Promise<readonly Neighbor[]>;

export interface CascadeInput {
  snapshot: VaultSnapshot;
  charter: Charter;
  charterPath: string | null;
  /** Similarity search over all notes; enables the kNN stage. In Obsidian it answers from a worker. */
  neighbors?: NeighborLookup;
  llm?: LlmStage;
  /** How confidences are combined at the end; false keeps each stage's raw confidence. */
  calibration?: CalibrationOptions | false;
}

export interface KnnOptions {
  /** Placed neighbours that vote. */
  k: number;
  /** A destination must hold this share of the vote… */
  minShare: number;
  /** …from at least this many neighbours… */
  minSupporters: number;
  /** …and the closest of them must be at least this similar. */
  minSimilarity: number;
}

/**
 * Tuned for precision on the eval fixtures (docs/EVALS.md): a wrong kNN decision becomes a proposed
 * move, while an abstention only costs a model call. The similarity floor suits embeddings;
 * word statistics score lower and use WORD_KNN.
 */
export const DEFAULT_KNN: KnnOptions = { k: 7, minShare: 0.75, minSupporters: 3, minSimilarity: 0.5 };
export const WORD_KNN: KnnOptions = { ...DEFAULT_KNN, minSimilarity: 0.15 };

export interface Classification {
  placements: Map<string, Placement>;
  /** Notes the cascade leaves alone: ignored, the charter itself, templates. */
  skipped: string[];
  targets: Target[];
}

/** The destinations a note can be classified into, plus `root` in properties mode. */
export function classificationTargets(charter: Charter): Target[] {
  const targets: Target[] = charter.destinations.map((d) => ({ id: d.id, description: d.description, path: d.path ?? null, layout: d.layout }));
  if (charter.mode === 'properties') {
    targets.push({ id: ROOT, description: 'Your own notes about your own life, work and ideas: they stay in the vault root.', path: '', layout: 'flat' });
  }
  return targets;
}

/**
 * The cost-aware classification cascade (PLAN §7.6): deterministic rules first, notes already in
 * a destination next, then a vote among similar notes that are already placed (kNN), and only
 * then the language model, for whatever is still open. A note no stage can place is left
 * undecided; the plan flags it for the user rather than guessing.
 */
export async function classifyNotes(input: CascadeInput, knn: KnnOptions = DEFAULT_KNN): Promise<Classification> {
  const { snapshot, charter } = input;
  const engine = new RuleEngine(charter, input.charterPath);
  const targets = classificationTargets(charter);
  const byId = new Map(charter.destinations.map((d) => [d.id, d]));
  const placements = new Map<string, Placement>();
  const skipped: string[] = [];
  const pending: NoteRecord[] = [];

  for (const note of snapshot.notes) {
    const placement = engine.evaluate(note);
    switch (placement.status) {
      case 'ignored':
      case 'charter':
        skipped.push(note.path);
        break;
      case 'system':
        if (placement.role === 'daily') placements.set(note.path, decided(note, DAILY, null, 'rule', `Daily note (${placement.rule}).`, { rule: placement.rule }));
        else skipped.push(note.path);
        break;
      case 'ruled': {
        const destination = placement.destination;
        const subfolder = subfolderOf(note, destination) ?? (destination.layout === 'subfolder-per-item' ? note.basename : null);
        placements.set(note.path, decided(note, destination.id, subfolder, 'rule', `Rule "${placement.rule}".`, { rule: placement.rule }));
        break;
      }
      case 'placed': {
        const id = placement.destination?.id ?? ROOT;
        const subfolder = placement.destination ? subfolderOf(note, placement.destination) : null;
        placements.set(note.path, decided(note, id, subfolder, 'rule', 'Already where the charter puts it.', { inPlace: true }));
        break;
      }
      case 'inbox':
      case 'unplaced':
        pending.push(note);
        break;
    }
  }

  // kNN: vote among placed neighbours (rules and in-place notes are the anchors).
  const anchors = new Map(placements);
  const kinds = new Set(charter.destinations.filter(isKindDestination).map((d) => d.id));
  const stillOpen: NoteRecord[] = [];
  for (const note of pending) {
    const signal = input.neighbors ? await vote(note, input.neighbors, anchors, knn, kinds) : null;
    if (signal && signal.share >= knn.minShare && signal.supporters >= knn.minSupporters && signal.similarity >= knn.minSimilarity) {
      const destination = byId.get(signal.destination);
      const subfolder = destination && destination.layout !== 'flat' ? signal.subfolder : null;
      const why = `${signal.supporters} of the most similar placed notes are in ${signal.destination}.`;
      placements.set(note.path, decided(note, signal.destination, subfolder, 'knn', why, { knn: signal }, signal.share));
    } else {
      stillOpen.push(note);
      if (signal) placements.set(note.path, undecided(note, { knn: signal }));
    }
  }

  // The language model, for the rest.
  if (input.llm && stillOpen.length > 0) {
    const decisions = await input.llm(stillOpen, { charter, targets, placed: placements });
    for (const note of stillOpen) {
      const decision = decisions.get(note.path);
      if (!decision) continue;
      const signals = { ...(placements.get(note.path)?.signals ?? {}), llm: decision };
      placements.set(
        note.path,
        decision.destination === null
          ? undecided(note, signals, decision.rationale)
          : decided(note, decision.destination, decision.subfolder, 'llm', decision.rationale, signals, decision.confidence),
      );
    }
  }
  for (const note of stillOpen) if (!placements.has(note.path)) placements.set(note.path, undecided(note, {}));
  if (input.calibration !== false) calibrateAll(placements, input.calibration ?? DEFAULT_CALIBRATION);
  return { placements, skipped, targets };
}

function decided(note: NoteRecord, destination: string, subfolder: string | null, source: PlacementSource, rationale: string, signals: Signals, confidence = 1): Placement {
  return { path: note.path, destination, subfolder, confidence, source, rationale, signals };
}

function undecided(note: NoteRecord, signals: Signals, rationale = 'No rule, similar notes or model could place it with confidence.'): Placement {
  return { path: note.path, destination: null, subfolder: null, confidence: 0, source: null, rationale, signals };
}

/** The first folder below the destination that contains the note, for item and topic layouts. */
function subfolderOf(note: NoteRecord, destination: Destination): string | null {
  if (!destination.path || destination.layout === 'flat' || !isInFolder(note.path, destination.path)) return null;
  const rest = note.path.slice(destination.path.length + 1).split('/');
  return rest.length > 1 ? (rest[0] ?? null) : null;
}

/** `type` values that say what kind of note something is, not what it is about. */
const KIND_TYPES = new Set(['meeting', 'source', 'person', 'log', 'map', 'moc', 'daily', 'fleeting', 'literature', 'permanent', 'hub', 'structure', 'category']);

/**
 * Destinations defined by what kind of note something is (meetings, sources, people, logs)
 * rather than by its subject: all their rules test a kind `type` or a date or timestamp file
 * name. A meeting note resembles the project it is about, so similar content cannot tell kinds
 * apart; rules and the language model decide these, never kNN.
 */
export function isKindDestination(destination: Destination): boolean {
  return (
    destination.match.length > 0 &&
    destination.match.every((rule) => {
      if ('filename' in rule) return /\\d\{(4|1\d)/.test(rule.filename);
      if ('property' in rule && 'equals' in rule && rule.property.toLowerCase() === 'type') {
        const values = Array.isArray(rule.equals) ? rule.equals : [rule.equals];
        return values.every((value) => KIND_TYPES.has(String(value).toLowerCase()));
      }
      return false;
    })
  );
}

async function vote(note: NoteRecord, neighbors: NeighborLookup, anchors: ReadonlyMap<string, Placement>, options: KnnOptions, kinds: ReadonlySet<string>): Promise<KnnSignal | null> {
  // Ask for extra neighbours: unplaced ones don't vote, and neither do daily notes, which are
  // placed by their file name and mention every subject in passing, or notes in kind destinations.
  const placed = (await neighbors(note.path, options.k * 4))
    .filter((n) => {
      const destination = anchors.get(n.path)?.destination;
      return n.score > 0 && destination !== undefined && destination !== null && destination !== DAILY && !kinds.has(destination);
    })
    .slice(0, options.k);
  if (placed.length === 0) return null;
  const weights = new Map<string, number>();
  let total = 0;
  for (const neighbor of placed) {
    const destination = anchors.get(neighbor.path)?.destination as string;
    weights.set(destination, (weights.get(destination) ?? 0) + neighbor.score);
    total += neighbor.score;
  }
  const [winner, weight] = [...weights].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] as [string, number];
  const supporters = placed.filter((n) => anchors.get(n.path)?.destination === winner);
  const subfolders = new Map<string, number>();
  for (const neighbor of supporters) {
    const subfolder = anchors.get(neighbor.path)?.subfolder;
    if (subfolder) subfolders.set(subfolder, (subfolders.get(subfolder) ?? 0) + neighbor.score);
  }
  const [bestSubfolder, subfolderWeight] = [...subfolders].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? [null, 0];
  return {
    destination: winner,
    share: total === 0 ? 0 : weight / total,
    similarity: supporters[0]?.score ?? 0,
    supporters: supporters.length,
    // A subfolder is suggested only when most of the winning vote agrees on it.
    subfolder: bestSubfolder !== null && subfolderWeight >= weight / 2 ? bestSubfolder : null,
    neighbors: placed.map((n) => n.path),
  };
}
