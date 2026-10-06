import type { OperationPreview } from '../../core/apply/preview';
import type { ValidationReport } from '../../core/apply/validate';
import type { Charter } from '../../core/charter/schema';
import { type Operation, type OperationSource, PHASE } from '../../core/model/operation';
import { describeOperation, KIND_LABELS } from '../../core/model/operation-text';
import { isInFolder } from '../../core/model/paths';
import type { Plan } from '../../core/model/plan';
import type { ApplyState } from './run-report';

/** A reviewer's decision on one operation; `pending` operations are neither applied nor dropped. */
export type Decision = 'pending' | 'accepted' | 'rejected';
export type Decisions = ReadonlyMap<string, Decision>;

export interface ReviewItem {
  op: Operation;
  description: string;
  /** Heading of the group the item is listed under. */
  group: string;
  /** Destination folder of a move (for the filter); null for everything else. */
  destination: string | null;
  /** Flags only inform: there is nothing to accept. */
  decidable: boolean;
  /** Validation problems of this operation. */
  issues: { severity: 'error' | 'warning'; message: string }[];
}

export interface ReviewFilters {
  source: OperationSource | 'all';
  /** Items below this confidence are hidden (flags are always shown). */
  minConfidence: number;
  /** A destination folder, or 'all'. */
  destination: string;
  status: Decision | 'all';
  /** Case-insensitive text in the description or rationale. */
  query: string;
}

export const NO_FILTERS: ReviewFilters = { source: 'all', minConfidence: 0, destination: 'all', status: 'all', query: '' };

export const ATTENTION = 'Needs your attention';

/** Every operation of a plan as a review row, grouped by what it does and where notes go. */
export function reviewItems(plan: Plan, validation: ValidationReport, charter: Charter | null): ReviewItem[] {
  const issues = new Map<string, ReviewItem['issues']>();
  for (const issue of validation.issues) {
    if (!issue.opId) continue;
    issues.set(issue.opId, [...(issues.get(issue.opId) ?? []), { severity: issue.severity, message: issue.message }]);
  }
  const destinations = (charter?.destinations ?? []).map((d) => d.path).filter((path): path is string => path !== undefined);
  return plan.operations.map((op) => {
    const destination = op.kind === 'move' ? (destinations.filter((path) => isInFolder(op.to, path)).sort((a, b) => b.length - a.length)[0] ?? (op.to.includes('/') ? op.to.slice(0, op.to.lastIndexOf('/')) : 'vault root')) : null;
    const group = op.kind === 'flag' ? ATTENTION : op.kind === 'move' ? `Moves into ${destination ?? ''}` : KIND_LABELS[op.kind];
    return { op, description: describeOperation(op), group, destination, decidable: op.kind !== 'flag', issues: issues.get(op.id) ?? [] };
  });
}

export interface ReviewGroup {
  title: string;
  items: ReviewItem[];
}

/** Groups in apply order (folders, moves, edits, maps of content), flags first: they need a person. */
export function groupItems(items: readonly ReviewItem[]): ReviewGroup[] {
  const groups = new Map<string, ReviewItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const rank = (group: ReviewGroup) => (group.title === ATTENTION ? -1 : PHASE[group.items[0]?.op.kind ?? 'flag']);
  return [...groups].map(([title, members]) => ({ title, items: members })).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** The decisions a plan was saved with: accepted and rejected operations keep their status. */
export function initialDecisions(plan: Plan): Map<string, Decision> {
  return new Map(plan.operations.map((op) => [op.id, op.status === 'accepted' || op.status === 'rejected' ? op.status : 'pending']));
}

export function matches(item: ReviewItem, decision: Decision, filters: ReviewFilters): boolean {
  if (filters.source !== 'all' && item.op.source !== filters.source) return false;
  if (item.decidable && item.op.confidence < filters.minConfidence) return false;
  if (filters.destination !== 'all' && item.destination !== filters.destination) return false;
  if (filters.status !== 'all' && decision !== filters.status) return false;
  const query = filters.query.trim().toLowerCase();
  return query === '' || item.description.toLowerCase().includes(query) || item.op.rationale.toLowerCase().includes(query);
}

/**
 * Decides operations, keeping dependent ones consistent: accepting an edit also accepts the move it
 * waits for, and rejecting (or undeciding) a move does the same to the edits that need it. Without
 * this, an accepted edit of a rejected move would silently be skipped at apply time.
 */
export function decide(plan: Plan, decisions: Decisions, opIds: readonly string[], decision: Decision): Map<string, Decision> {
  const byId = new Map(plan.operations.map((op) => [op.id, op]));
  const dependents = new Map<string, string[]>();
  for (const op of plan.operations) for (const id of op.dependsOn ?? []) dependents.set(id, [...(dependents.get(id) ?? []), op.id]);
  const next = new Map(decisions);
  const visit = (id: string, edges: (op: Operation) => readonly string[]) => {
    const op = byId.get(id);
    if (!op || op.kind === 'flag' || next.get(id) === decision) return;
    next.set(id, decision);
    for (const other of edges(op)) visit(other, edges);
  };
  for (const id of opIds) {
    next.delete(id);
    visit(id, decision === 'accepted' ? (op) => op.dependsOn ?? [] : (op) => dependents.get(op.id) ?? []);
  }
  return next;
}

/** Accepts every shown, undecided operation at or above the threshold ("accept all ≥ X"). */
export function acceptAbove(plan: Plan, decisions: Decisions, shown: readonly ReviewItem[], threshold: number): Map<string, Decision> {
  const ids = shown.filter((item) => item.decidable && decisions.get(item.op.id) === 'pending' && item.op.confidence >= threshold).map((item) => item.op.id);
  return decide(plan, decisions, ids, 'accepted');
}

/** The plan with the reviewer's decisions as statuses; flags and undecided operations stay pending. */
export function decidedPlan(plan: Plan, decisions: Decisions): Plan {
  return {
    ...plan,
    operations: plan.operations.map((op) => {
      const decision = decisions.get(op.id) ?? 'pending';
      return op.kind === 'flag' || decision === 'pending' ? { ...op, status: 'pending' } : { ...op, status: decision };
    }),
  };
}

export function decisionCounts(items: readonly ReviewItem[], decisions: Decisions): Record<Decision, number> {
  const counts: Record<Decision, number> = { pending: 0, accepted: 0, rejected: 0 };
  for (const item of items) if (item.decidable) counts[decisions.get(item.op.id) ?? 'pending']++;
  return counts;
}

/** Destinations moves go to, for the filter. */
export function destinationsOf(items: readonly ReviewItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.destination ? [item.destination] : [])))].sort();
}

/** What the review view holds; the component re-renders when it changes. */
export interface ReviewModel {
  plan: Plan;
  items: ReviewItem[];
  validation: ValidationReport;
  /** Obsidian is set not to update links when notes move; moving needs an explicit OK. */
  linksAutoUpdateOff: boolean;
  /** A run is changing the vault; nothing can be applied meanwhile. */
  busy: boolean;
  /** Starting value of "accept all at or above". */
  threshold: number;
  /** A run started from this review, while it runs and until its report is closed. */
  apply: ApplyState | null;
}

/** What the review's buttons do; the view wires them to the plugin. */
export interface ReviewActions {
  preview: (op: Operation) => Promise<OperationPreview>;
  /** Decisions changed: keep them with the pending plan. */
  save: (plan: Plan) => void;
  apply: (plan: Plan) => void;
  /** Stops the running apply after its current batch. */
  cancelApply: () => void;
  /** Undoes the run just reported. */
  undoRun: () => void;
  /** Leaves the report and returns to what is left to review. */
  closeApply: () => void;
  openNote: (path: string) => void;
}
