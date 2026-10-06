import { replaceCharterBlock } from '../markdown/charter-block';
import { insertRelatedLinks } from '../markdown/related-links';
import { replaceGeneratedSection } from '../markdown/generated-sections';
import { addTagsToFrontmatter, replaceInlineTag, replaceTagInFrontmatter } from '../markdown/tags-edit';
import { isMutation, type Operation, type OperationOf } from '../model/operation';
import { ancestorFolders, parentFolder } from '../model/paths';
import type { Plan } from '../model/plan';
import type { Hasher, LinkIndex, Logger, VaultReader, VaultWriter } from '../ports';
import type { InverseAction, Journal, RunStatus } from './journal';
import { orderOperations } from './order';

export interface ExecutorDeps {
  reader: VaultReader;
  /** The only writer in the plugin (invariant 2). */
  writer: VaultWriter;
  links: LinkIndex;
  journal: Journal;
  hasher: Hasher;
  logger: Logger;
}

export interface OperationResult {
  opId: string;
  status: 'applied' | 'skipped' | 'failed';
  reason?: string;
}

export interface BatchCheck {
  ok: boolean;
  message?: string;
}

export interface ApplyOptions {
  runId?: string;
  /** Storage key of the backup taken before this run; recorded in the journal. */
  backupKey?: string | null;
  batchSize?: number;
  /** Checked between batches; a cancelled run stops after the current batch and stays undoable. */
  signal?: { readonly aborted: boolean };
  onProgress?: (progress: { done: number; total: number }) => void;
  /** Runs after each batch once the link index caught up (link verification, §5.7). */
  afterBatch?: (context: { batchIndex: number; moves: ReadonlyMap<string, string> }) => Promise<BatchCheck>;
}

export interface RunReport {
  runId: string;
  planId: string;
  status: RunStatus;
  results: OperationResult[];
  applied: number;
  skipped: number;
  failed: number;
  message?: string;
}

/** Thrown by an operation that cannot run as planned; reported as a failure, never retried. */
class OperationError extends Error {}

/**
 * Executes the accepted operations of a validated plan (§5.5): preconditions first, then phase by
 * phase in batches. Every change is journaled with its inverse before the next one starts, so a run
 * that fails, is cancelled or crashes midway can always be undone up to the last journaled step.
 * Validation and backups are the caller's job (see run.ts), which keeps this class focused.
 */
export class ApplyExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async apply(plan: Plan, options: ApplyOptions = {}): Promise<RunReport> {
    const { journal, logger } = this.deps;
    const runId = options.runId ?? journal.newRunId(plan.id);
    const ops = orderOperations(plan.operations.filter((op) => op.status === 'accepted' && isMutation(op)));
    const batchSize = Math.max(1, options.batchSize ?? 50);
    const results = new Map<string, OperationResult>();
    /** Original path → new path of every note moved so far in this run. */
    const moves = new Map<string, string>();

    await journal.append(runId, {
      type: 'run',
      runId,
      planId: plan.id,
      startedAt: journal.now(),
      backupKey: options.backupKey ?? null,
      operationCount: ops.length,
    });

    for (const op of ops) {
      const reason = await this.preconditionFailure(op);
      if (reason) results.set(op.id, { opId: op.id, status: 'skipped', reason });
    }

    let status: RunStatus = 'completed';
    let message: string | undefined;
    let done = 0;
    outer: for (let start = 0; start < ops.length; start += batchSize) {
      if (options.signal?.aborted) {
        status = 'cancelled';
        message = 'Cancelled before all batches ran.';
        break;
      }
      for (const op of ops.slice(start, start + batchSize)) {
        options.onProgress?.({ done: done++, total: ops.length });
        if (results.has(op.id)) continue;
        const blocked = (op.dependsOn ?? []).find((dep) => results.get(dep) && results.get(dep)?.status !== 'applied');
        if (blocked) {
          results.set(op.id, { opId: op.id, status: 'skipped', reason: `Depends on ${blocked}, which was not applied.` });
          continue;
        }
        try {
          const inverses = await this.execute(op);
          if (inverses === null) {
            results.set(op.id, { opId: op.id, status: 'skipped', reason: 'Already in the desired state.' });
          } else {
            await journal.append(runId, { type: 'op', opId: op.id, kind: op.kind, appliedAt: journal.now(), inverses });
            results.set(op.id, { opId: op.id, status: 'applied' });
            if (op.kind === 'move') moves.set(op.from, op.to);
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          logger.error(`Operation ${op.id} failed`, text);
          results.set(op.id, { opId: op.id, status: 'failed', reason: text });
          status = 'failed';
          message = `Stopped after a failed operation: ${text}`;
          break outer;
        }
      }
      await this.deps.writer.waitForIndex();
      const check = await options.afterBatch?.({ batchIndex: start / batchSize, moves });
      if (check && !check.ok) {
        status = 'verification-failed';
        message = check.message ?? 'Link verification failed.';
        break;
      }
    }

    options.onProgress?.({ done, total: ops.length });
    const list = ops.map((op) => results.get(op.id)).filter((r): r is OperationResult => r !== undefined);
    const count = (s: OperationResult['status']) => list.filter((r) => r.status === s).length;
    await journal.append(runId, {
      type: 'end',
      status,
      finishedAt: journal.now(),
      applied: count('applied'),
      skipped: count('skipped'),
      failed: count('failed'),
      message,
    });
    return { runId, planId: plan.id, status, results: list, applied: count('applied'), skipped: count('skipped'), failed: count('failed'), message };
  }

  private async preconditionFailure(op: Operation): Promise<string | null> {
    if (!op.precondition) return null;
    const { path, contentHash } = op.precondition;
    if (!(await this.deps.reader.exists(path))) return `"${path}" no longer exists.`;
    const current = await this.deps.hasher.sha256(await this.deps.reader.read(path));
    return current === contentHash ? null : `"${path}" changed since the plan was made.`;
  }

  /** Runs one operation; returns its inverses, or null when there was nothing to change. */
  private async execute(op: Operation): Promise<InverseAction[] | null> {
    switch (op.kind) {
      case 'createFolder':
        return this.createFolder(op);
      case 'move':
        return this.move(op);
      case 'setProperty':
        return this.editContent(op.path, () => this.deps.writer.processFrontmatter(op.path, (fm) => (fm[op.key] = op.value)));
      case 'renameProperty':
        return this.editContent(op.path, () => this.deps.writer.processFrontmatter(op.path, (fm) => renameProperty(fm, op.from, op.to)));
      case 'addTags':
        return this.editContent(op.path, () => this.deps.writer.processFrontmatter(op.path, (fm) => void addTagsToFrontmatter(fm, op.tags)));
      case 'replaceTag':
        return this.editContent(op.path, async () => {
          await this.deps.writer.processFrontmatter(op.path, (fm) => void replaceTagInFrontmatter(fm, op.from, op.to));
          await this.deps.writer.processBody(op.path, (content) => replaceInlineTag(content, op.from, op.to));
        });
      case 'addRelatedLinks':
        return this.addRelatedLinks(op);
      case 'createNote':
        return this.createNote(op);
      case 'updateGeneratedSection':
        return this.editContent(op.path, () =>
          this.deps.writer.processBody(op.path, (content) => {
            const result = replaceGeneratedSection(content, op.sectionId, op.content);
            if (!result.ok) throw new OperationError(`Generated section "${op.sectionId}" is ${result.error} in "${op.path}".`);
            return result.value;
          }),
        );
      case 'updateCharterRules':
        return this.editContent(op.path, () =>
          this.deps.writer.processBody(op.path, (content) => {
            const result = replaceCharterBlock(content, op.yaml);
            if (!result.ok) throw new OperationError(`"${op.path}" has no charter block.`);
            return result.value;
          }),
        );
      case 'flag':
        return null;
    }
  }

  private async createFolder(op: OperationOf<'createFolder'>): Promise<InverseAction[] | null> {
    if (await this.deps.reader.exists(op.path)) return null;
    return this.ensureFolder(op.path);
  }

  /** Creates a folder and any missing ancestors, returning inverses that remove what was created. */
  private async ensureFolder(folder: string): Promise<InverseAction[]> {
    const inverses: InverseAction[] = [];
    if (folder === '') return inverses;
    for (const path of ancestorFolders(`${folder}/x`)) {
      if (await this.deps.reader.exists(path)) continue;
      await this.deps.writer.createFolder(path);
      inverses.push({ type: 'removeFolder', path });
    }
    return inverses;
  }

  private async move(op: OperationOf<'move'>): Promise<InverseAction[]> {
    const { reader, writer, links, hasher } = this.deps;
    if (!(await reader.exists(op.from))) throw new OperationError(`"${op.from}" does not exist.`);
    if (op.from.toLowerCase() !== op.to.toLowerCase() && (await reader.exists(op.to))) {
      throw new OperationError(`"${op.to}" already exists.`);
    }
    const inverses = await this.ensureFolder(parentFolder(op.to));

    // Obsidian rewrites links in notes pointing at the moved file (and possibly in the file itself).
    // Remember their contents so undo can restore them exactly.
    const candidates = [...new Set([op.from, ...(await links.backlinks(op.from))])];
    const before = new Map<string, string>();
    for (const path of candidates) before.set(path, await reader.read(path));

    await writer.move(op.from, op.to);
    await writer.waitForIndex();

    const sideEffects = [];
    for (const path of candidates) {
      const now = path === op.from ? op.to : path;
      const previous = before.get(path) ?? '';
      const current = await reader.read(now);
      if (current !== previous) sideEffects.push({ path: now, beforeContent: previous, afterHash: await hasher.sha256(current) });
    }
    const redirected = [];
    for (const path of await links.backlinks(op.to)) {
      if (candidates.includes(path) || path === op.to) continue;
      redirected.push({ path, afterHash: await hasher.sha256(await reader.read(path)) });
    }
    const afterHash = await hasher.sha256(await reader.read(op.to));
    inverses.push({ type: 'moveBack', from: op.to, to: op.from, afterHash, sideEffects, redirected });
    return inverses;
  }

  private async addRelatedLinks(op: OperationOf<'addRelatedLinks'>): Promise<InverseAction[] | null> {
    const { links } = this.deps;
    const existing = new Set(await links.outgoing(op.path));
    const targets = op.targets.filter((target) => target !== op.path && !existing.has(target));
    if (targets.length === 0) return null;
    const texts = await Promise.all(targets.map((target) => links.linkText(target, op.path)));
    return this.editContent(op.path, () =>
      this.deps.writer.processBody(op.path, (content) => insertRelatedLinks(content, op.heading, texts).content),
    );
  }

  private async createNote(op: OperationOf<'createNote'>): Promise<InverseAction[]> {
    if (await this.deps.reader.exists(op.path)) throw new OperationError(`"${op.path}" already exists.`);
    const inverses = await this.ensureFolder(parentFolder(op.path));
    await this.deps.writer.create(op.path, op.content);
    const afterHash = await this.deps.hasher.sha256(await this.deps.reader.read(op.path));
    inverses.push({ type: 'trashCreated', path: op.path, afterHash });
    return inverses;
  }

  /** Wraps a content edit: captures the previous content so undo can restore it byte for byte. */
  private async editContent(path: string, edit: () => Promise<void>): Promise<InverseAction[] | null> {
    const { reader, hasher } = this.deps;
    if (!(await reader.exists(path))) throw new OperationError(`"${path}" does not exist.`);
    const before = await reader.read(path);
    await edit();
    const after = await reader.read(path);
    if (after === before) return null;
    return [{ type: 'restoreContent', path, beforeContent: before, afterHash: await hasher.sha256(after) }];
  }
}

/**
 * Renames a frontmatter key in place, keeping its value and its position among the keys. A key
 * already present under the new name is never overwritten: the operation fails instead.
 */
export function renameProperty(frontmatter: Record<string, unknown>, from: string, to: string): void {
  if (!(from in frontmatter) || from === to) return;
  if (to in frontmatter) throw new OperationError(`The note already has a property "${to}"; "${from}" was left as it is.`);
  const entries = Object.entries(frontmatter).map(([key, value]) => [key === from ? to : key, value] as const);
  for (const key of Object.keys(frontmatter)) delete frontmatter[key];
  for (const [key, value] of entries) frontmatter[key] = value;
}
