import { Notice } from 'obsidian';
import type { RunReport } from '../../core/apply/executor';
import type { RunStatus } from '../../core/apply/journal';
import type { RunOutcome, RunPhase } from '../../core/apply/run';
import { validatePlan } from '../../core/apply/validate';
import { loadCharter } from '../../core/charter/load';
import { describeOperation } from '../../core/model/operation-text';
import type { Plan } from '../../core/model/plan';
import { plural } from '../../core/model/text';
import { charterRoots } from '../../core/planner/rule-plan';
import { isLinkAutoUpdateEnabled } from '../adapters/obsidian-vault-writer';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';
import { PlanReviewModal } from '../views/plan-review-modal';
import { exclusive } from './exclusive';

export interface CharterConstraints {
  ignore: string[];
  /** Undefined when there is no valid charter yet (e.g. while creating the first one). */
  allowedRoots?: string[];
}

/**
 * Limits from the current charter that every plan must respect: its ignore globs, and its
 * destinations (plus the charter note itself) as the only places to create or move notes into.
 */
export async function charterConstraints(plugin: AiVaultOrganizerPlugin): Promise<CharterConstraints> {
  const load = await loadCharter(plugin.services.reader, plugin.services.hasher, plugin.settings.charterPath);
  if (load.status !== 'ok') return { ignore: [] };
  return { ignore: load.charter.ignore, allowedRoots: [...charterRoots(load.charter), load.path] };
}

export async function reviewPendingPlan(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const plan = await plugin.services.plans.latest();
  const open = plan?.operations.filter((op) => op.status === 'pending' || op.status === 'accepted') ?? [];
  if (!plan || open.length === 0) {
    new Notice('There is no pending plan to review.');
    return;
  }
  await openReview(plugin, { ...plan, operations: open });
}

/** Validates a plan against the vault and the charter, then shows it for review. */
export async function openReview(plugin: AiVaultOrganizerPlugin, plan: Plan): Promise<void> {
  const constraints = await charterConstraints(plugin);
  const validation = validatePlan(plan, { snapshot: await plugin.services.reader.snapshot(), include: () => true, ...constraints });
  new PlanReviewModal(plugin.app, {
    plan,
    validation,
    linksAutoUpdate: isLinkAutoUpdateEnabled(plugin.app),
    onApply: (decided) => void exclusive(plugin, () => applyPlan(plugin, decided)),
  }).open();
}

const PHASE_TEXT: Record<RunPhase, string> = {
  validating: 'Checking the plan…',
  'backing-up': 'Creating backup…',
  applying: 'Applying changes…',
};

/**
 * Runs a reviewed plan through the single write path with progress notices and saves the plan's
 * new statuses. Returns the outcome; shows a modal only for invalid plans.
 */
export async function runPlan(plugin: AiVaultOrganizerPlugin, plan: Plan, constraints?: CharterConstraints): Promise<RunOutcome> {
  const { plans, runs } = plugin.services;
  await plans.save(plan);
  const limits = constraints ?? (await charterConstraints(plugin));
  const notice = new Notice(PHASE_TEXT.validating, 0);
  try {
    const outcome = await runs.run(plan, {
      pluginVersion: plugin.manifest.version,
      includeAttachments: plugin.settings.backupIncludeAttachments,
      retention: plugin.settings.backupRetention,
      ignore: limits.ignore,
      allowedRoots: limits.allowedRoots,
      onPhase: (phase) => notice.setMessage(PHASE_TEXT[phase]),
      onProgress: ({ done, total }) => notice.setMessage(`Applying changes… ${done} of ${total}`),
    });
    if (outcome.kind === 'invalid') {
      new MessageModal(plugin.app, {
        title: 'The plan cannot be applied',
        paragraphs: ['Nothing was changed. Fix or reject these operations and try again:'],
        items: outcome.validation.issues.filter((i) => i.severity === 'error').map((i) => i.message),
      }).open();
    } else {
      await plans.save(outcome.plan);
    }
    return outcome;
  } finally {
    notice.hide();
  }
}

export async function applyPlan(plugin: AiVaultOrganizerPlugin, plan: Plan): Promise<void> {
  const outcome = await runPlan(plugin, plan);
  if (outcome.kind === 'ran') showRunReport(plugin, outcome.report, outcome.plan, outcome.backup.key);
}

const STATUS_TITLES: Record<RunStatus, string> = {
  completed: 'Changes applied',
  failed: 'Run stopped after an error',
  cancelled: 'Run cancelled',
  'verification-failed': 'Run stopped to protect your links',
};

export function showRunReport(plugin: AiVaultOrganizerPlugin, report: RunReport, plan: Plan, backupKey: string): void {
  const byId = new Map(plan.operations.map((op) => [op.id, op]));
  const problems = report.results
    .filter((result) => result.status !== 'applied')
    .map((result) => {
      const op = byId.get(result.opId);
      return `${op ? describeOperation(op) : result.opId}: ${result.reason ?? result.status}`;
    });
  new MessageModal(plugin.app, {
    title: STATUS_TITLES[report.status],
    paragraphs: [
      `${plural(report.applied, 'change')} applied, ${report.skipped} skipped, ${report.failed} failed.`,
      ...(report.message ? [report.message] : []),
      `A backup was saved to .ai-vault-organizer/${backupKey}. Run "Undo last run" to revert these changes.`,
    ],
    items: problems,
  }).open();
}
