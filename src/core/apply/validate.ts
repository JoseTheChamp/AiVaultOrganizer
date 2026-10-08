import { matchesAnyGlob } from '../model/glob';
import type { VaultSnapshot } from '../model/note';
import { PLUGIN_DATA_FOLDER } from '../model/note';
import { type Operation, PHASE, touchedPaths } from '../model/operation';
import { ancestorFolders, extension, isInFolder, normalizeVaultPath } from '../model/paths';
import type { Plan } from '../model/plan';
import { orderOperations } from './order';

export type ValidationCode =
  | 'duplicate-id'
  | 'invalid-path'
  | 'protected-path'
  | 'ignored-path'
  | 'outside-destinations'
  | 'not-markdown'
  | 'no-op'
  | 'missing-source'
  | 'target-exists'
  | 'moved-twice'
  | 'missing-link-target'
  | 'unknown-dependency'
  | 'dependency-cycle'
  | 'dependency-order'
  | 'folder-exists'
  | 'folder-not-empty'
  | 'charter-folder'
  | 'stale-precondition';

export interface ValidationIssue {
  code: ValidationCode;
  severity: 'error' | 'warning';
  message: string;
  opId?: string;
}

export interface ValidationReport {
  /** True when no error was found; warnings never block. */
  ok: boolean;
  issues: ValidationIssue[];
  /** Operations whose precondition no longer holds; the executor skips them. */
  staleOpIds: string[];
}

export interface ValidationContext {
  snapshot: VaultSnapshot;
  /** Globs no operation may touch (charter `ignore`). */
  ignore?: readonly string[];
  /**
   * Folders that moves, new notes and new folders must stay inside (charter destinations, inbox,
   * system folders). Omit to allow any folder.
   */
  allowedRoots?: readonly string[];
  /** Which operations to validate; defaults to accepted ones (what apply would execute). */
  include?: (op: Operation) => boolean;
}

/**
 * Validates a plan against the current vault before review and again right before apply (§5.3).
 * It simulates the plan in execution order over a virtual copy of the vault's paths, so it catches
 * collisions between operations, not only with existing files. Path comparisons are
 * case-insensitive because Windows and macOS file systems are.
 */
export function validatePlan(plan: Plan, context: ValidationContext): ValidationReport {
  const include = context.include ?? ((op: Operation) => op.status === 'accepted');
  const operations = plan.operations.filter(include);
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationCode, message: string, opId?: string, severity: 'error' | 'warning' = 'error') =>
    issues.push({ code, severity, message, opId });

  const seen = new Set<string>();
  for (const op of operations) {
    if (seen.has(op.id)) add('duplicate-id', `Operation id ${op.id} appears more than once.`, op.id);
    seen.add(op.id);
  }

  checkDependencies(operations, add);
  for (const op of operations) checkPaths(op, context, add);

  const staleOpIds = checkPreconditions(operations, context.snapshot, add);
  simulate(orderOperations(operations), context.snapshot, add);

  return { ok: !issues.some((issue) => issue.severity === 'error'), issues, staleOpIds };
}

type Add = (code: ValidationCode, message: string, opId?: string, severity?: 'error' | 'warning') => void;

function checkDependencies(operations: Operation[], add: Add): void {
  const byId = new Map(operations.map((op) => [op.id, op]));
  for (const op of operations) {
    for (const dep of op.dependsOn ?? []) {
      const target = byId.get(dep);
      if (!target) add('unknown-dependency', `Depends on ${dep}, which is not part of the plan.`, op.id);
      else if (PHASE[target.kind] > PHASE[op.kind]) {
        add('dependency-order', `Depends on a ${target.kind} that runs in a later phase.`, op.id);
      }
    }
  }
  // Cycle detection with a depth-first search over declared dependencies.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      add('dependency-cycle', `Dependency cycle: ${[...trail, id].join(' → ')}.`, id);
      return;
    }
    state.set(id, 'visiting');
    for (const dep of byId.get(id)?.dependsOn ?? []) if (byId.has(dep)) visit(dep, [...trail, id]);
    state.set(id, 'done');
  };
  for (const op of operations) visit(op.id, []);
}

function checkPaths(op: Operation, context: ValidationContext, add: Add): void {
  for (const path of touchedPaths(op)) {
    if (normalizeVaultPath(path) !== path || path.split('/').includes('..')) {
      add('invalid-path', `"${path}" is not a normalized vault path.`, op.id);
    } else if (path.split('/').some((segment) => segment.startsWith('.')) || isInFolder(path, PLUGIN_DATA_FOLDER)) {
      add('protected-path', `"${path}" is a hidden or configuration path the plugin never touches.`, op.id);
    } else if (matchesAnyGlob(path, context.ignore ?? [])) {
      add('ignored-path', `"${path}" matches the charter's ignore list.`, op.id);
    }
  }

  const created = op.kind === 'move' ? op.to : op.kind === 'createNote' || op.kind === 'createFolder' ? op.path : null;
  if (created !== null && context.allowedRoots && !context.allowedRoots.some((root) => isInFolder(created, root))) {
    add('outside-destinations', `"${created}" is outside every destination of the charter.`, op.id);
  }

  // The charter's own folders and their parents stay, even when nothing is in them yet.
  if (op.kind === 'removeEmptyFolder' && context.allowedRoots?.some((root) => isInFolder(root, op.path))) {
    add('charter-folder', `"${op.path}" is one of the charter's folders; it stays.`, op.id);
  }

  if (op.kind === 'move') {
    // v1 moves notes only; attachments stay where they are.
    if (extension(op.from) !== 'md' || extension(op.to) !== 'md') add('not-markdown', 'Only Markdown notes can be moved.', op.id);
    if (op.from === op.to) add('no-op', 'The note already is at this path.', op.id);
  }
  if (op.kind === 'createNote' && extension(op.path) !== 'md') add('not-markdown', 'New notes must be Markdown files.', op.id);
}

function checkPreconditions(operations: Operation[], snapshot: VaultSnapshot, add: Add): string[] {
  const hashes = new Map(snapshot.notes.map((note) => [note.path, note.contentHash]));
  const stale: string[] = [];
  for (const op of operations) {
    if (!op.precondition) continue;
    if (hashes.get(op.precondition.path) !== op.precondition.contentHash) {
      stale.push(op.id);
      add('stale-precondition', `"${op.precondition.path}" changed since the plan was made; this operation will be skipped.`, op.id, 'warning');
    }
  }
  return stale;
}

/** Applies the plan to a set of paths, reporting every operation that could not succeed. */
function simulate(ordered: Operation[], snapshot: VaultSnapshot, add: Add): void {
  const files = new Map<string, string>();
  for (const path of [...snapshot.notes.map((n) => n.path), ...snapshot.otherFiles.map((f) => f.path)]) {
    files.set(path.toLowerCase(), path);
  }
  const folders = new Set(snapshot.folders.map((f) => f.toLowerCase()));
  const movedFrom = new Map<string, string>(); // lower original path → op id
  const movedTo = new Map<string, string>(); // lower original path → new path
  const exists = (path: string) => files.has(path.toLowerCase());
  const occupied = (path: string) => exists(path) || folders.has(path.toLowerCase());
  const addFolders = (path: string) => {
    // Moves and new notes create missing parent folders implicitly.
    for (const folder of ancestorFolders(path)) folders.add(folder.toLowerCase());
  };

  for (const op of ordered) {
    switch (op.kind) {
      case 'createFolder':
        if (folders.has(op.path.toLowerCase())) {
          add('folder-exists', `Folder "${op.path}" already exists; nothing to create.`, op.id, 'warning');
        } else if (exists(op.path)) {
          add('target-exists', `A file named "${op.path}" already exists.`, op.id);
        } else {
          addFolders(`${op.path}/x`);
        }
        break;
      case 'move': {
        if (movedFrom.has(op.from.toLowerCase())) {
          add('moved-twice', `"${op.from}" is already moved by ${movedFrom.get(op.from.toLowerCase())}.`, op.id);
          break;
        }
        if (!exists(op.from)) {
          add('missing-source', `"${op.from}" does not exist.`, op.id);
          break;
        }
        if (op.from.toLowerCase() !== op.to.toLowerCase() && occupied(op.to)) {
          add('target-exists', `"${op.to}" already exists or is the target of another move.`, op.id);
          break;
        }
        files.delete(op.from.toLowerCase());
        files.set(op.to.toLowerCase(), op.to);
        addFolders(op.to);
        movedFrom.set(op.from.toLowerCase(), op.id);
        movedTo.set(op.from.toLowerCase(), op.to);
        break;
      }
      case 'setProperty':
      case 'renameProperty':
      case 'addTags':
      case 'replaceTag':
      case 'updateGeneratedSection':
      case 'updateCharterRules':
      case 'addRelatedLinks':
        if (!exists(op.path)) {
          const moved = movedTo.get(op.path.toLowerCase());
          add(
            'missing-source',
            moved ? `"${op.path}" is moved earlier in this plan; refer to "${moved}".` : `"${op.path}" does not exist.`,
            op.id,
          );
        }
        if (op.kind === 'addRelatedLinks') {
          for (const target of op.targets) {
            if (!exists(target)) add('missing-link-target', `Link target "${target}" does not exist at this point.`, op.id);
          }
        }
        break;
      case 'createNote':
        if (occupied(op.path)) add('target-exists', `"${op.path}" already exists.`, op.id);
        else {
          files.set(op.path.toLowerCase(), op.path);
          addFolders(op.path);
        }
        break;
      case 'removeEmptyFolder': {
        const folder = op.path.toLowerCase();
        if (!folders.has(folder)) {
          add('missing-source', `Folder "${op.path}" does not exist.`, op.id, 'warning');
          break;
        }
        const inside = (path: string) => path.startsWith(`${folder}/`);
        if ([...files.keys()].some(inside) || [...folders].some(inside)) {
          add('folder-not-empty', `Something stays in "${op.path}" after this plan, so the folder is kept.`, op.id, 'warning');
        } else {
          folders.delete(folder);
        }
        break;
      }
      case 'flag':
        break;
    }
  }
}
