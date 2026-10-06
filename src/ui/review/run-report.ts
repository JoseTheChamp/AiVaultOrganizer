import type { RunReport } from '../../core/apply/executor';
import type { RunStatus } from '../../core/apply/journal';
import type { RunPhase } from '../../core/apply/run';
import { describeOperation } from '../../core/model/operation-text';
import type { Plan } from '../../core/model/plan';
import { plural } from '../../core/model/text';

export const RUN_TITLES: Record<RunStatus, string> = {
  completed: 'Changes applied',
  failed: 'Run stopped after an error',
  cancelled: 'Run cancelled',
  'verification-failed': 'Run stopped to protect your links',
};

/** Everything the run report shows (PLAN §9.1: counts, verification, health before and after, undo). */
export interface RunReportState {
  status: RunStatus;
  title: string;
  /** "12 changes applied, 1 skipped, 0 failed." */
  counts: string;
  message: string | null;
  /** Each operation that did not apply, with why. */
  problems: string[];
  /** Where the backup taken before the run lives. */
  backup: string;
  health: { before: number; after: number } | null;
  /** Something changed, so there is something to undo. */
  undoable: boolean;
}

export interface RunReportInput {
  report: RunReport;
  plan: Plan;
  backupKey: string;
  health?: { before: number; after: number };
}

export function runReportState({ report, plan, backupKey, health }: RunReportInput): RunReportState {
  const byId = new Map(plan.operations.map((op) => [op.id, op]));
  return {
    status: report.status,
    title: RUN_TITLES[report.status],
    counts: `${plural(report.applied, 'change')} applied, ${report.skipped} skipped, ${report.failed} failed.`,
    message: report.message ?? null,
    problems: report.results
      .filter((result) => result.status !== 'applied')
      .map((result) => {
        const op = byId.get(result.opId);
        return `${op ? describeOperation(op) : result.opId}: ${result.reason ?? result.status}`;
      }),
    backup: `.ai-vault-organizer/${backupKey}`,
    health: health ?? null,
    undoable: report.applied > 0,
  };
}

/** A run in progress, or its report once it has finished. */
export interface ApplyState {
  phase: RunPhase | 'done';
  done: number;
  total: number;
  /** Cancel was pressed: the run stops after the current batch. */
  cancelling: boolean;
  report: RunReportState | null;
  /** The plan did not pass validation: nothing was changed. */
  invalid: string[] | null;
}

export const PHASE_LABELS: Record<RunPhase, string> = {
  validating: 'Checking the plan against the vault…',
  'backing-up': 'Creating a backup…',
  applying: 'Applying changes…',
};
