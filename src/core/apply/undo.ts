import type { Hasher, Logger, VaultReader, VaultWriter } from '../ports';
import type { InverseAction, Journal, JournalRun } from './journal';

export interface UndoConflict {
  opId: string;
  path: string;
  reason: string;
}

export interface UndoReport {
  runId: string;
  status: 'completed' | 'partial' | 'already-undone';
  /** Inverse actions carried out. */
  restored: number;
  /** Actions skipped to protect changes made after the run, with the reason. */
  conflicts: UndoConflict[];
}

export interface UndoDeps {
  reader: VaultReader;
  writer: VaultWriter;
  journal: Journal;
  hasher: Hasher;
  logger: Logger;
}

/**
 * Undoes an apply run from its journal (§5.6): operations newest first, each operation's inverses
 * in reverse order. Before touching a file it checks that the file still has exactly the hash the
 * run left behind; if the user changed it since, that step is skipped and reported, never forced.
 * Steps that depend on a skipped one fail the same check, so undo degrades conservatively.
 */
export class UndoService {
  constructor(private readonly deps: UndoDeps) {}

  async undoLast(): Promise<UndoReport | null> {
    const run = await this.deps.journal.lastUndoableRun();
    return run ? this.undoRun(run) : null;
  }

  async undo(runId: string): Promise<UndoReport> {
    return this.undoRun(await this.deps.journal.read(runId));
  }

  private async undoRun(run: JournalRun): Promise<UndoReport> {
    const runId = run.run.runId;
    if (run.undo) return { runId, status: 'already-undone', restored: 0, conflicts: [] };

    let restored = 0;
    const conflicts: UndoConflict[] = [];
    for (const op of [...run.ops].reverse()) {
      for (const inverse of [...op.inverses].reverse()) {
        try {
          const conflict = await this.apply(inverse);
          if (conflict) conflicts.push({ opId: op.opId, ...conflict });
          else restored++;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.deps.logger.error(`Undo step for ${op.opId} failed`, reason);
          conflicts.push({ opId: op.opId, path: pathOf(inverse), reason: `Failed: ${reason}` });
        }
      }
    }
    await this.deps.writer.waitForIndex();
    await this.deps.journal.append(runId, { type: 'undo', at: this.deps.journal.now(), restored, conflicts });
    return { runId, status: conflicts.length === 0 ? 'completed' : 'partial', restored, conflicts };
  }

  /** Carries out one inverse; returns a conflict instead when doing so could lose user changes. */
  private async apply(inverse: InverseAction): Promise<{ path: string; reason: string } | null> {
    const { reader, writer } = this.deps;
    switch (inverse.type) {
      case 'restoreContent': {
        const problem = await this.changedSince(inverse.path, inverse.afterHash);
        if (problem) return problem;
        await writer.processBody(inverse.path, () => inverse.beforeContent);
        return null;
      }
      case 'trashCreated': {
        if (!(await reader.exists(inverse.path))) return null;
        const problem = await this.changedSince(inverse.path, inverse.afterHash);
        if (problem) return { path: inverse.path, reason: 'Kept: you edited this note after it was created.' };
        await writer.trashPluginCreated(inverse.path);
        return null;
      }
      case 'removeFolder': {
        if (!(await reader.exists(inverse.path))) return null;
        const removed = await writer.removeEmptyFolder(inverse.path);
        return removed ? null : { path: inverse.path, reason: 'Kept: the folder is not empty.' };
      }
      case 'moveBack':
        return this.moveBack(inverse);
    }
  }

  private async moveBack(inverse: Extract<InverseAction, { type: 'moveBack' }>): Promise<{ path: string; reason: string } | null> {
    const { reader, writer, hasher } = this.deps;
    const problem = await this.changedSince(inverse.from, inverse.afterHash);
    if (problem) return problem;
    if (inverse.from.toLowerCase() !== inverse.to.toLowerCase() && (await reader.exists(inverse.to))) {
      return { path: inverse.from, reason: `Kept: "${inverse.to}" is occupied by another file now.` };
    }

    // Only restore link rewrites in notes nobody edited since; others keep Obsidian's own update.
    const unedited = async (path: string, hash: string) =>
      (await reader.exists(path)) && (await hasher.sha256(await reader.read(path))) === hash;
    const untouched = new Set<string>();
    for (const effect of inverse.sideEffects) if (await unedited(effect.path, effect.afterHash)) untouched.add(effect.path);
    const redirected = new Map<string, string>();
    for (const note of inverse.redirected) {
      if (await unedited(note.path, note.afterHash)) redirected.set(note.path, await reader.read(note.path));
    }

    await writer.move(inverse.from, inverse.to);
    await writer.waitForIndex();

    for (const effect of inverse.sideEffects) {
      if (!untouched.has(effect.path)) continue;
      const path = effect.path === inverse.from ? inverse.to : effect.path;
      if ((await reader.read(path)) !== effect.beforeContent) await writer.processBody(path, () => effect.beforeContent);
    }
    // These links never pointed at the moved note before the run; undo their rewrite.
    for (const [path, content] of redirected) {
      if ((await reader.read(path)) !== content) await writer.processBody(path, () => content);
    }
    return null;
  }

  private async changedSince(path: string, afterHash: string): Promise<{ path: string; reason: string } | null> {
    if (!(await this.deps.reader.exists(path))) return { path, reason: 'Skipped: the file no longer exists.' };
    const current = await this.deps.hasher.sha256(await this.deps.reader.read(path));
    return current === afterHash ? null : { path, reason: 'Skipped: the note was edited after the run.' };
  }
}

function pathOf(inverse: InverseAction): string {
  return inverse.type === 'moveBack' ? inverse.from : inverse.path;
}
