import { Notice } from 'obsidian';
import type { RunReport } from '../../core/apply/executor';
import type { RunOptions, RunOutcome } from '../../core/apply/run';
import { loadCharter } from '../../core/charter/load';
import type { Plan } from '../../core/model/plan';
import { charterRoots } from '../../core/planner/charter-roots';
import { PHASE_LABELS, runReportState } from '../../ui/review/run-report';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';

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
  await openReview(plugin, plan);
}

/** Saves a plan as the pending one and opens it in the review view. */
export async function openReview(plugin: AiVaultOrganizerPlugin, plan: Plan): Promise<void> {
  await plugin.services.plans.save(plan);
  plugin.changed();
  await plugin.openReview(plan.id);
}

/** Progress and cancelling for a run shown in a view; without them a notice reports progress. */
export type RunHandlers = Pick<RunOptions, 'signal' | 'onPhase' | 'onProgress'>;

/**
 * Runs a reviewed plan through the single write path and saves the plan's new statuses. Returns
 * the outcome. Without handlers, progress shows in a notice and an invalid plan in a modal.
 */
export async function runPlan(plugin: AiVaultOrganizerPlugin, plan: Plan, constraints?: CharterConstraints, handlers?: RunHandlers): Promise<RunOutcome> {
  const { plans, runs } = plugin.services;
  await plans.save(plan);
  const limits = constraints ?? (await charterConstraints(plugin));
  const notice = handlers ? null : new Notice(PHASE_LABELS.validating, 0);
  try {
    const outcome = await runs.run(plan, {
      pluginVersion: plugin.manifest.version,
      includeAttachments: plugin.settings.backupIncludeAttachments,
      retention: plugin.settings.backupRetention,
      ignore: limits.ignore,
      allowedRoots: limits.allowedRoots,
      signal: handlers?.signal,
      onPhase: handlers?.onPhase ?? ((phase) => notice?.setMessage(PHASE_LABELS[phase])),
      onProgress: handlers?.onProgress ?? (({ done, total }) => notice?.setMessage(`Applying changes… ${done} of ${total}`)),
    });
    if (outcome.kind === 'invalid' && !handlers) {
      new MessageModal(plugin.app, {
        title: 'The plan cannot be applied',
        paragraphs: ['Nothing was changed. Fix or reject these operations and try again:'],
        items: outcome.validation.issues.filter((i) => i.severity === 'error').map((i) => i.message),
      }).open();
    } else if (outcome.kind === 'ran') {
      await plans.save(outcome.plan);
    }
    return outcome;
  } finally {
    notice?.hide();
  }
}

/** A run report in a modal, for runs started outside the review (writing the charter). */
export function showRunReport(plugin: AiVaultOrganizerPlugin, report: RunReport, plan: Plan, backupKey: string): void {
  const state = runReportState({ report, plan, backupKey });
  new MessageModal(plugin.app, {
    title: state.title,
    paragraphs: [state.counts, ...(state.message ? [state.message] : []), `A backup was saved to ${state.backup}. Run "Undo last run" to revert these changes.`],
    items: state.problems,
  }).open();
}
