import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { previewOperation } from '../../core/apply/preview';
import { analyzeVault } from '../../core/analysis/analyze';
import { validatePlan } from '../../core/apply/validate';
import { loadCharter } from '../../core/charter/load';
import { plural } from '../../core/model/text';
import { DEFAULT_KNN, WORD_KNN } from '../../core/planner/classify';
import { rerankFromDecisions } from '../../core/planner/rerank';
import type { Plan } from '../../core/model/plan';
import { type MountedComponent, mountComponent } from '../../ui/mount';
import { reactive } from '../../ui/reactive.svelte';
import PlanReview from '../../ui/review/PlanReview.svelte';
import { type ReviewActions, type ReviewModel, reviewItems } from '../../ui/review/review-state';
import { runReportState } from '../../ui/review/run-report';
import { confirmUndo } from '../flows/backup-undo';
import { isLinkAutoUpdateEnabled } from '../adapters/obsidian-vault-writer';
import { exclusive } from '../flows/exclusive';
import { indexingProgress } from '../flows/indexing';
import { planRealignment } from '../flows/plan';
import { charterConstraints, runPlan } from '../flows/review';
import type AiVaultOrganizerPlugin from '../main';

export const REVIEW_VIEW = 'ai-vault-organizer-review';

/** Statuses a reviewer still decides on; applied, skipped and failed operations are history. */
const OPEN = new Set(['pending', 'accepted', 'rejected']);

/**
 * The plan review (PLAN §9.1) in the main area: summary and warnings, filters, previews, per-row
 * and bulk decisions, then apply. The plan id is the view's state, so the review survives a restart;
 * decisions are saved with the plan as they are made.
 */
export class ReviewView extends ItemView {
  private planId: string | null = null;
  /** The whole stored plan; the review shows its open operations. */
  private plan: Plan | null = null;
  private component: MountedComponent | null = null;
  private model: ReviewModel | null = null;
  private saving: Promise<unknown> = Promise.resolve();
  /** The running apply's cancel flag, checked by the executor between batches. */
  private signal = { aborted: false };

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AiVaultOrganizerPlugin,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return REVIEW_VIEW;
  }

  override getDisplayText(): string {
    return 'Review proposed changes';
  }

  override getIcon(): string {
    return 'list-checks';
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), planId: this.planId };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const planId = typeof state === 'object' && state !== null && 'planId' in state && typeof state.planId === 'string' ? state.planId : null;
    if (planId && planId !== this.planId) {
      this.planId = planId;
      await this.reload();
    }
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    this.registerEvent(
      this.plugin.changes.on('changed', () => {
        if (this.model) this.model.busy = this.plugin.busy;
        // A run updated the plan's statuses: show what is left to decide (after its report).
        if (!this.plugin.busy && !this.model?.apply) void this.reload();
      }),
    );
    await this.reload();
  }

  override async onClose(): Promise<void> {
    await this.saving;
    this.component?.destroy();
    this.component = null;
    this.model = null;
  }

  private async reload(): Promise<void> {
    if (!this.planId) return;
    const { plans, reader, hasher } = this.plugin.services;
    const loaded = await plans.load(this.planId);
    if (!loaded.ok) {
      this.contentEl.empty();
      this.contentEl.createEl('p', { cls: 'avo-error', text: `The plan could not be read: ${loaded.error.join('; ')}` });
      return;
    }
    this.plan = loaded.value;
    const open: Plan = { ...loaded.value, operations: loaded.value.operations.filter((op) => OPEN.has(op.status)) };
    const charter = await loadCharter(reader, hasher, this.plugin.settings.charterPath);
    const validation = validatePlan(open, { snapshot: await reader.snapshot(), include: () => true, ...(await charterConstraints(this.plugin)) });
    const fields: ReviewModel = {
      plan: open,
      items: reviewItems(open, validation, charter.status === 'ok' ? charter.charter : null),
      validation,
      linksAutoUpdateOff: isLinkAutoUpdateEnabled(this.app) === false,
      busy: this.plugin.busy,
      threshold: 0.8,
      aiReady: this.plugin.services.ai.chat() !== null,
      apply: this.model?.apply ?? null,
    };
    if (this.model) {
      Object.assign(this.model, fields);
      return;
    }
    if (open.operations.length === 0) {
      this.contentEl.empty();
      this.contentEl.createEl('p', { cls: 'avo-muted', text: 'Every change in this plan has been applied or dropped. Plan re-alignment again to see what is left.' });
      return;
    }
    this.model = reactive(fields);
    this.contentEl.empty();
    this.component = mountComponent(PlanReview, this.contentEl, { model: this.model, actions: this.actions() });
  }

  private actions(): ReviewActions {
    const { plugin } = this;
    const { reader, links } = plugin.services;
    return {
      preview: (op) => previewOperation(op, { read: (path) => reader.read(path), linkText: (target, source) => links.linkText(target, source) }),
      save: (decided) => void this.save(decided),
      apply: (decided) => void this.apply(decided),
      learn: (decided) => void this.learn(decided),
      cancelApply: () => {
        this.signal.aborted = true;
        if (this.model?.apply) this.model.apply.cancelling = true;
      },
      undoRun: () => void confirmUndo(plugin),
      setUpAi: () =>
        void (async () => {
          if (await plugin.openAiSetup()) await planRealignment(plugin);
        })(),
      closeApply: () => {
        if (this.model) this.model.apply = null;
        void this.reload();
      },
      openNote: (path) => void this.app.workspace.openLinkText(path, '', 'tab'),
    };
  }

  /**
   * Applies the accepted changes with progress and a report in the view (PLAN §9.1): the health
   * score before and after, problems by operation, the backup and undo.
   */
  private async apply(decided: Plan): Promise<void> {
    await this.save(decided);
    const model = this.model;
    if (!this.plan || !model) return;
    const plan = this.merged(decided);
    const { reader } = this.plugin.services;
    this.signal = { aborted: false };
    const signal = this.signal;
    await exclusive(this.plugin, async () => {
      model.apply = { phase: 'validating', done: 0, total: 0, cancelling: false, report: null, invalid: null };
      const health = async () => analyzeVault(await reader.snapshot(), { now: Date.now() }).health.score;
      const before = await health();
      const outcome = await runPlan(this.plugin, plan, undefined, {
        signal,
        onPhase: (phase) => {
          if (model.apply) model.apply.phase = phase;
        },
        onProgress: ({ done, total }) => {
          if (model.apply) Object.assign(model.apply, { done, total });
        },
      });
      if (outcome.kind === 'invalid') {
        model.apply = { ...(model.apply ?? { done: 0, total: 0, cancelling: false }), phase: 'done', report: null, invalid: outcome.validation.issues.filter((i) => i.severity === 'error').map((i) => i.message) };
        return;
      }
      const report = runReportState({ report: outcome.report, plan: outcome.plan, backupKey: outcome.backup.key, health: { before, after: await health() } });
      model.apply = { ...(model.apply ?? { done: 0, total: 0, cancelling: false }), phase: 'done', report, invalid: null };
    });
  }

  /**
   * Re-ranks the undecided rows from the decisions made so far (PLAN §7.6): accepted places become
   * anchors for kNN, rejected ones are ruled out. Similarity comes from the same index as planning.
   */
  private async learn(decided: Plan): Promise<void> {
    await this.save(decided);
    if (!this.plan) return;
    const { reader, hasher, similarity, ai } = this.plugin.services;
    const charter = await loadCharter(reader, hasher, this.plugin.settings.charterPath);
    if (charter.status !== 'ok') {
      new Notice('The charter cannot be read, so there is nothing to learn against. Fix the charter first.');
      return;
    }
    const progress = indexingProgress(this.plugin);
    try {
      const source = await similarity.neighborSource({ provider: ai.embeddings(), ignore: charter.charter.ignore, exclude: [charter.path], ...progress.options });
      progress.say('Learning from your decisions…');
      const result = await rerankFromDecisions({
        plan: this.plan,
        snapshot: await reader.snapshot(),
        charter: charter.charter,
        charterPath: charter.path,
        neighbors: source.neighbors,
        knn: source.method === 'embeddings' ? DEFAULT_KNN : WORD_KNN,
      });
      this.plan = result.plan;
      await this.plugin.services.plans.save(result.plan);
      await this.reload();
      new Notice(
        result.rescored + result.placed === 0
          ? 'Your decisions do not change the other suggestions yet. Decide a few more similar notes and try again.'
          : `Updated ${plural(result.rescored, 'suggestion')}${result.placed > 0 ? ` and proposed a place for ${plural(result.placed, 'flagged note')}` : ''}.`,
      );
    } finally {
      progress.hide();
    }
  }

  /** The stored plan with the reviewer's statuses on its open operations. */
  private merged(decided: Plan): Plan {
    const statuses = new Map(decided.operations.map((op) => [op.id, op.status]));
    const plan = this.plan as Plan;
    return { ...plan, operations: plan.operations.map((op) => ({ ...op, status: statuses.get(op.id) ?? op.status })) };
  }

  /** Saves decisions in order, so a slow write never overtakes a newer one. */
  private save(decided: Plan): Promise<unknown> {
    if (!this.plan) return this.saving;
    const plan = this.merged(decided);
    this.plan = plan;
    this.saving = this.saving.then(() => this.plugin.services.plans.save(plan));
    return this.saving;
  }
}
