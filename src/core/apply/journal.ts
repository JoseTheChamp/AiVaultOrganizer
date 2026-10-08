import * as z from 'zod';
import { stableHash } from '../model/stable-hash';
import type { Clock, StoragePort } from '../ports';

/**
 * Append-only JSONL journal, one file per apply run under `journal/<runId>.jsonl` in the plugin's
 * storage. Every applied operation records how to undo it; undo appends its own entry instead of
 * rewriting history.
 *
 * Content edits store the full previous content plus the hash of what the plugin wrote. Undo only
 * restores when the file still has exactly that hash, so user edits made after the run are never
 * overwritten, and restoring yields byte-identical notes.
 */

const path = z.string().min(1);

export const inverseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('restoreContent'), path, beforeContent: z.string(), afterHash: z.string() }),
  z.object({
    type: z.literal('moveBack'),
    /** Where the note is after the run. */
    from: path,
    /** Where it was before. */
    to: path,
    afterHash: z.string(),
    /** Notes whose links Obsidian rewrote because of the move (and the moved note's own links). */
    sideEffects: z.array(z.object({ path, beforeContent: z.string(), afterHash: z.string() })),
    /**
     * Notes whose unchanged link text started resolving to the moved note (e.g. `[[Alpha]]` now
     * matching a note moved to the root). Moving back makes Obsidian rewrite those links, so undo
     * puts their text back.
     */
    redirected: z.array(z.object({ path, afterHash: z.string() })).default([]),
  }),
  z.object({ type: z.literal('removeFolder'), path }),
  /** A folder the run removed because its moves left it empty (ADR 0009). */
  z.object({ type: z.literal('recreateFolder'), path }),
  z.object({ type: z.literal('trashCreated'), path, afterHash: z.string() }),
]);

export type InverseAction = z.infer<typeof inverseSchema>;

const runEntry = z.object({
  type: z.literal('run'),
  runId: z.string(),
  planId: z.string(),
  startedAt: z.string(),
  backupKey: z.string().nullable(),
  operationCount: z.number().int(),
});

const opEntry = z.object({
  type: z.literal('op'),
  opId: z.string(),
  kind: z.string(),
  appliedAt: z.string(),
  /** Executed in reverse order on undo. */
  inverses: z.array(inverseSchema),
});

export const RUN_STATUSES = ['completed', 'failed', 'cancelled', 'verification-failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const endEntry = z.object({
  type: z.literal('end'),
  status: z.enum(RUN_STATUSES),
  finishedAt: z.string(),
  applied: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  message: z.string().optional(),
});

const undoEntry = z.object({
  type: z.literal('undo'),
  at: z.string(),
  restored: z.number().int(),
  conflicts: z.array(z.object({ opId: z.string(), path: z.string(), reason: z.string() })),
});

export const journalEntrySchema = z.discriminatedUnion('type', [runEntry, opEntry, endEntry, undoEntry]);
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type RunEntry = z.infer<typeof runEntry>;
export type OpEntry = z.infer<typeof opEntry>;
export type EndEntry = z.infer<typeof endEntry>;
export type UndoEntry = z.infer<typeof undoEntry>;

export interface JournalRun {
  run: RunEntry;
  ops: OpEntry[];
  end: EndEntry | null;
  undo: UndoEntry | null;
}

const PREFIX = 'journal/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Journal {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: Clock,
  ) {}

  static key(runId: string): string {
    return `${PREFIX}${runId}.jsonl`;
  }

  /** Sortable, unique-enough run id: UTC timestamp plus a short hash of the plan id. */
  newRunId(planId: string): string {
    const now = this.clock.now();
    const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return `${stamp}-${stableHash(`${planId}:${now}`).slice(0, 6)}`;
  }

  async append(runId: string, entry: JournalEntry): Promise<void> {
    const line = `${JSON.stringify(journalEntrySchema.parse(entry))}\n`;
    await this.storage.append(Journal.key(runId), encoder.encode(line));
  }

  now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  async read(runId: string): Promise<JournalRun> {
    const data = await this.storage.read(Journal.key(runId));
    if (!data) throw new Error(`No journal for run ${runId}`);
    let run: RunEntry | null = null;
    const ops: OpEntry[] = [];
    let end: EndEntry | null = null;
    let undo: UndoEntry | null = null;
    const lines = decoder.decode(data).split('\n').filter((line) => line.trim() !== '');
    for (const [index, line] of lines.entries()) {
      const parsed = journalEntrySchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`Journal ${runId} line ${index + 1} is invalid`);
      const entry = parsed.data;
      if (entry.type === 'run') run = entry;
      else if (entry.type === 'op') ops.push(entry);
      else if (entry.type === 'end') end = entry;
      else undo = entry;
    }
    if (!run) throw new Error(`Journal ${runId} has no run header`);
    return { run, ops, end, undo };
  }

  /** Run ids, newest first. */
  async runIds(): Promise<string[]> {
    const keys = await this.storage.list(PREFIX);
    return keys
      .filter((key) => key.endsWith('.jsonl'))
      .map((key) => key.slice(PREFIX.length, -'.jsonl'.length))
      .sort()
      .reverse();
  }

  /** The newest run that changed something and has not been undone yet. */
  async lastUndoableRun(): Promise<JournalRun | null> {
    for (const runId of await this.runIds()) {
      const run = await this.read(runId);
      if (run.undo === null && run.ops.length > 0) return run;
    }
    return null;
  }
}
