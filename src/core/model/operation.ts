import * as z from 'zod';
import { stableHash } from './stable-hash';

/**
 * Operations are the only way the plugin changes a vault (invariant 2). They are plain data,
 * produced by rules, kNN, an LLM or the user, reviewed by the user and executed by the apply
 * executor. There is deliberately no delete operation (invariant 1): "removing" a note means
 * moving it to an archive destination. The one removal is of a folder the plan's own moves leave
 * empty, which holds no content (ADR 0009).
 */

export const OPERATION_SOURCES = ['rule', 'knn', 'llm', 'user'] as const;
export const OPERATION_STATUSES = ['pending', 'accepted', 'rejected', 'applied', 'skipped', 'failed'] as const;
export const FLAG_ISSUES = ['orphan', 'stub', 'duplicate', 'query-breakage', 'ambiguous'] as const;
export const NOTE_ROLES = ['charter', 'moc', 'category'] as const;

const vaultPath = z.string().min(1).max(1024);

const base = {
  /** Deterministic hash of kind, target and parameters: re-planning yields the same ids. */
  id: z.string().min(1),
  /** Why the operation is proposed; shown in review. */
  rationale: z.string(),
  /** Calibrated confidence 0..1; bulk accept uses it. */
  confidence: z.number().min(0).max(1),
  source: z.enum(OPERATION_SOURCES),
  status: z.enum(OPERATION_STATUSES),
  dependsOn: z.array(z.string()).optional(),
  /** The operation is skipped when the note changed since planning. */
  precondition: z.object({ path: vaultPath, contentHash: z.string() }).optional(),
};

export const operationSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('createFolder'), path: vaultPath }),
  /** Removes a folder only if it is empty when applied; undo recreates it (ADR 0009). */
  z.object({ ...base, kind: z.literal('removeEmptyFolder'), path: vaultPath }),
  z.object({ ...base, kind: z.literal('move'), from: vaultPath, to: vaultPath }),
  z.object({ ...base, kind: z.literal('setProperty'), path: vaultPath, key: z.string().min(1), value: z.json() }),
  /** Renames a property key, keeping its value and position (e.g. Type to type). */
  z.object({ ...base, kind: z.literal('renameProperty'), path: vaultPath, from: z.string().min(1), to: z.string().min(1) }),
  z.object({ ...base, kind: z.literal('addTags'), path: vaultPath, tags: z.array(z.string().min(1)).min(1) }),
  z.object({ ...base, kind: z.literal('replaceTag'), path: vaultPath, from: z.string().min(1), to: z.string().min(1) }),
  z.object({
    ...base,
    kind: z.literal('addRelatedLinks'),
    path: vaultPath,
    /** Heading under which links are listed, e.g. `## Related`. Created when missing. */
    heading: z.string().min(1),
    targets: z.array(vaultPath).min(1),
  }),
  z.object({ ...base, kind: z.literal('createNote'), path: vaultPath, role: z.enum(NOTE_ROLES), content: z.string() }),
  z.object({
    ...base,
    kind: z.literal('updateGeneratedSection'),
    path: vaultPath,
    sectionId: z.string().min(1),
    content: z.string(),
  }),
  z.object({
    ...base,
    kind: z.literal('updateCharterRules'),
    path: vaultPath,
    /** New YAML for the note's charter block. */
    yaml: z.string().min(1),
  }),
  z.object({
    ...base,
    kind: z.literal('flag'),
    path: vaultPath,
    issue: z.enum(FLAG_ISSUES),
    related: z.array(vaultPath).optional(),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;
export type OperationKind = Operation['kind'];
export type OperationOf<K extends OperationKind> = Extract<Operation, { kind: K }>;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type OperationSource = (typeof OPERATION_SOURCES)[number];

/** Fields every operation shares; the rest is kind-specific "intent". */
type MetaKey = 'id' | 'rationale' | 'confidence' | 'source' | 'status' | 'dependsOn' | 'precondition';
export type OperationIntent = Operation extends infer O ? (O extends Operation ? Omit<O, MetaKey> : never) : never;
export type OperationMeta = Partial<Pick<Operation, Exclude<MetaKey, 'id'>>>;

/**
 * Execution phases (§5.5): folders exist before moves, moves happen before frontmatter edits,
 * links are added once targets are in place, generated notes come next, and the folders the moves
 * emptied go last, deepest first. `flag` never executes.
 */
export const PHASE: Record<OperationKind, number> = {
  createFolder: 0,
  move: 1,
  setProperty: 2,
  renameProperty: 2,
  addTags: 2,
  replaceTag: 2,
  addRelatedLinks: 3,
  createNote: 4,
  updateGeneratedSection: 4,
  updateCharterRules: 4,
  removeEmptyFolder: 5,
  flag: 6,
};

/** Deterministic id from the operation's intent, independent of rationale or confidence. */
export function operationId(intent: OperationIntent): string {
  return `${intent.kind}-${stableHash(intent).slice(0, 16)}`;
}

/** Builds a complete operation from its intent and optional metadata. */
export function createOperation<I extends OperationIntent>(intent: I, meta: OperationMeta = {}): Operation {
  return operationSchema.parse({
    rationale: '',
    confidence: 1,
    source: 'user',
    status: 'pending',
    ...meta,
    ...intent,
    id: operationId(intent),
  });
}

/** The note or folder an operation primarily acts on (for moves: the source). */
export function primaryPath(op: Operation): string {
  return op.kind === 'move' ? op.from : op.path;
}

/** Every vault path an operation reads or writes. */
export function touchedPaths(op: Operation): string[] {
  switch (op.kind) {
    case 'move':
      return [op.from, op.to];
    case 'addRelatedLinks':
      return [op.path, ...op.targets];
    case 'flag':
      return [op.path, ...(op.related ?? [])];
    case 'createFolder':
    case 'removeEmptyFolder':
    case 'setProperty':
    case 'renameProperty':
    case 'addTags':
    case 'replaceTag':
    case 'createNote':
    case 'updateGeneratedSection':
    case 'updateCharterRules':
      return [op.path];
  }
}

/** Operations that change the vault when applied (everything except `flag`). */
export function isMutation(op: Operation): boolean {
  return op.kind !== 'flag';
}
