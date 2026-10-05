import { Notice } from 'obsidian';
import { analyzeVault } from '../core/analysis/analyze';
import type { RunReport } from '../core/apply/executor';
import type { RunStatus } from '../core/apply/journal';
import type { RunPhase } from '../core/apply/run';
import { validatePlan } from '../core/apply/validate';
import { describeOperation } from '../core/model/operation-text';
import type { Plan } from '../core/model/plan';
import { plural } from '../core/model/text';
import { isLinkAutoUpdateEnabled } from './adapters/obsidian-vault-writer';
import type AiVaultOrganizerPlugin from './main';
import { DiagnosticsModal } from './views/diagnostics-modal';
import { MessageModal } from './views/message-modal';
import { PlanReviewModal } from './views/plan-review-modal';

/** Registers the command palette entries. Ids omit the plugin id; Obsidian prefixes them. */
export function registerCommands(plugin: AiVaultOrganizerPlugin): void {
  plugin.addCommand({ id: 'analyze-vault', name: 'Analyze vault', callback: () => void analyze(plugin) });
  plugin.addCommand({ id: 'review-pending-plan', name: 'Review pending plan', callback: () => void reviewPendingPlan(plugin) });
  plugin.addCommand({ id: 'create-backup', name: 'Create backup', callback: () => void exclusive(plugin, () => createBackup(plugin)) });
  plugin.addCommand({ id: 'undo-last-run', name: 'Undo last run', callback: () => void confirmUndo(plugin) });
}

/** Runs one vault-changing task at a time; a second request while one runs is refused. */
async function exclusive(plugin: AiVaultOrganizerPlugin, task: () => Promise<void>): Promise<void> {
  if (plugin.busy) {
    new Notice('Another vault operation is still running. Try again when it has finished.');
    return;
  }
  plugin.busy = true;
  try {
    await task();
  } catch (error) {
    plugin.services.logger.error('Vault operation failed', error);
    new Notice('The operation failed. Enable debug logging and check the developer console for details.');
  } finally {
    plugin.busy = false;
  }
}

async function analyze(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const notice = new Notice('Analyzing vault…', 0);
  try {
    const started = Date.now();
    const snapshot = await plugin.services.reader.snapshot();
    const analysis = analyzeVault(snapshot, { now: Date.now() });
    plugin.services.logger.debug(`Analyzed ${snapshot.notes.length} notes in ${Date.now() - started} ms`);
    new DiagnosticsModal(plugin.app, analysis).open();
  } catch (error) {
    plugin.services.logger.error('Vault analysis failed', error);
    new Notice('Vault analysis failed. Enable debug logging and check the developer console for details.');
  } finally {
    notice.hide();
  }
}

async function createBackup(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const { backups } = plugin.services;
  const notice = new Notice('Creating backup…', 0);
  try {
    const result = await backups.create({
      pluginVersion: plugin.manifest.version,
      includeAttachments: plugin.settings.backupIncludeAttachments,
    });
    await backups.prune(plugin.settings.backupRetention);
    new Notice(`Backup created: ${plural(result.manifest.files.length, 'file')} in .ai-vault-organizer/${result.key}.`);
  } finally {
    notice.hide();
  }
}

async function confirmUndo(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const run = await plugin.services.journal.lastUndoableRun();
  if (!run) {
    new Notice('There is no run to undo.');
    return;
  }
  new MessageModal(plugin.app, {
    title: 'Undo last run?',
    paragraphs: [
      `The run from ${new Date(run.run.startedAt).toLocaleString()} made ${plural(run.ops.length, 'change')}. Undo restores the notes exactly as they were before it.`,
      'Notes you edited after the run are left as they are and listed afterwards.',
    ],
    confirm: { label: 'Undo run', warning: true, onConfirm: () => void exclusive(plugin, () => undoRun(plugin, run.run.runId)) },
  }).open();
}

async function undoRun(plugin: AiVaultOrganizerPlugin, runId: string): Promise<void> {
  const notice = new Notice('Undoing run…', 0);
  try {
    const report = await plugin.services.undo.undo(runId);
    new MessageModal(plugin.app, {
      title: report.status === 'completed' ? 'Run undone' : 'Run partly undone',
      paragraphs: [
        `${plural(report.restored, 'change')} reverted.`,
        ...(report.conflicts.length > 0 ? ['These were left alone to protect later changes:'] : []),
      ],
      items: report.conflicts.map((conflict) => `${conflict.path}: ${conflict.reason}`),
    }).open();
  } finally {
    notice.hide();
  }
}

async function reviewPendingPlan(plugin: AiVaultOrganizerPlugin): Promise<void> {
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

async function applyPlan(plugin: AiVaultOrganizerPlugin, plan: Plan): Promise<void> {
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

function showRunReport(plugin: AiVaultOrganizerPlugin, report: RunReport, plan: Plan, backupKey: string): void {
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
