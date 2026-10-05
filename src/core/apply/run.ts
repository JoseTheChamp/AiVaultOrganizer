import type { Operation } from '../model/operation';
import type { Plan } from '../model/plan';
import type { Clock, StoragePort } from '../ports';
import { type BackupResult, BackupService } from './backup';
import { ApplyExecutor, type ApplyOptions, type ExecutorDeps, type RunReport } from './executor';
import { validatePlan, type ValidationReport } from './validate';
import { LinkVerifier } from './verify';

export interface RunServiceDeps extends ExecutorDeps {
  storage: StoragePort;
  clock: Clock;
}

export type RunPhase = 'validating' | 'backing-up' | 'applying';

export interface RunOptions extends Pick<ApplyOptions, 'batchSize' | 'signal' | 'onProgress'> {
  pluginVersion: string;
  ignore?: readonly string[];
  allowedRoots?: readonly string[];
  includeAttachments?: boolean;
  /** Number of backups to keep after this run. */
  retention?: number;
  onPhase?: (phase: RunPhase) => void;
}

export type RunOutcome =
  | { kind: 'invalid'; validation: ValidationReport }
  | { kind: 'ran'; validation: ValidationReport; backup: BackupResult; report: RunReport; plan: Plan };

/**
 * The single write path (invariant 2), end to end: validate the plan against the vault as it is
 * now, take the mandatory backup, then apply in batches with link verification after each batch.
 * Nothing is written when validation fails, and nothing is applied without a backup.
 */
export class ApplyRunService {
  constructor(private readonly deps: RunServiceDeps) {}

  async run(plan: Plan, options: RunOptions): Promise<RunOutcome> {
    options.onPhase?.('validating');
    const validation = validatePlan(plan, {
      snapshot: await this.deps.reader.snapshot(),
      ignore: options.ignore,
      allowedRoots: options.allowedRoots,
    });
    if (!validation.ok) return { kind: 'invalid', validation };

    options.onPhase?.('backing-up');
    const backups = new BackupService(this.deps);
    const backup = await backups.create({
      planId: plan.id,
      pluginVersion: options.pluginVersion,
      includeAttachments: options.includeAttachments,
    });
    await backups.prune(options.retention ?? 10);

    options.onPhase?.('applying');
    const verifier = new LinkVerifier(this.deps.links);
    await verifier.captureBaseline();
    const report = await new ApplyExecutor(this.deps).apply(plan, {
      backupKey: backup.key,
      batchSize: options.batchSize,
      signal: options.signal,
      onProgress: options.onProgress,
      afterBatch: ({ moves }) => verifier.check(moves),
    });
    return { kind: 'ran', validation, backup, report, plan: withResults(plan, report) };
  }
}

/** The plan with each executed operation's status set from a run report. */
export function withResults(plan: Plan, report: RunReport): Plan {
  const results = new Map(report.results.map((result) => [result.opId, result.status]));
  return {
    ...plan,
    operations: plan.operations.map((op): Operation => {
      const status = results.get(op.id);
      return status ? { ...op, status } : op;
    }),
  };
}
