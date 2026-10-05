import { Notice } from 'obsidian';
import type { RunReport } from '../../core/apply/executor';
import type { RunStatus } from '../../core/apply/journal';
import type { RunPhase } from '../../core/apply/run';
import { validatePlan } from '../../core/apply/validate';
import { describeOperation } from '../../core/model/operation-text';
import type { Plan } from '../../core/model/plan';
import { plural } from '../../core/model/text';
import { isLinkAutoUpdateEnabled } from '../adapters/obsidian-vault-writer';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';
import { PlanReviewModal } from '../views/plan-review-modal';
import { exclusive } from './exclusive';

export async function reviewPendingPlan(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const { plans, reader } = plugin.services;
  const plan = await plans.latest();
  const open = plan?.operations.filter((op) => op.status === 'pending' || op.status === 'accepted') ?? [];
  if (!plan || open.length === 0) {
    new Notice('There is no pending plan to review.');
    return;
  }
  const pending: Plan = { ...plan, operations: open };
  const validation = validatePlan(pending, { snapshot: await reader.snapshot(), include: () => true });
  new PlanReviewModal(plugin.app, {
    plan: pending,
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

export async function applyPlan(plugin: AiVaultOrganizerPlugin, plan: Plan): Promise<void> {
  const { plans, runs } = plugin.services;
  await plans.save(plan);
  const notice = new Notice(PHASE_TEXT.validating, 0);
  try {
    const outcome = await runs.run(plan, {
      pluginVersion: plugin.manifest.version,
      includeAttachments: plugin.settings.backupIncludeAttachments,
      retention: plugin.settings.backupRetention,
      onPhase: (phase) => notice.setMessage(PHASE_TEXT[phase]),
      onProgress: ({ done, total }) => notice.setMessage(`Applying changes… ${done} of ${total}`),
    });
    if (outcome.kind === 'invalid') {
      new MessageModal(plugin.app, {
        title: 'The plan cannot be applied',
        paragraphs: ['Nothing was changed. Fix or reject these operations and try again:'],
        items: outcome.validation.issues.filter((i) => i.severity === 'error').map((i) => i.message),
      }).open();
      return;
    }
    await plans.save(outcome.plan);
    showRunReport(plugin, outcome.report, outcome.plan, outcome.backup.key);
  } finally {
    notice.hide();
  }
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
