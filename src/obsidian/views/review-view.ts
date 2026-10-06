import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { previewOperation } from '../../core/apply/preview';
import { validatePlan } from '../../core/apply/validate';
import { loadCharter } from '../../core/charter/load';
import type { Plan } from '../../core/model/plan';
import { type MountedComponent, mountComponent } from '../../ui/mount';
import { reactive } from '../../ui/reactive.svelte';
import PlanReview from '../../ui/review/PlanReview.svelte';
import { type ReviewActions, type ReviewModel, reviewItems } from '../../ui/review/review-state';
import { isLinkAutoUpdateEnabled } from '../adapters/obsidian-vault-writer';
import { exclusive } from '../flows/exclusive';
import { applyPlan, charterConstraints } from '../flows/review';
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
        // A run updated the plan's statuses: show what is left to decide.
        if (!this.plugin.busy) void this.reload();
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
      apply: (decided) =>
        void (async () => {
          await this.save(decided);
          if (this.plan) await exclusive(plugin, () => applyPlan(plugin, this.merged(decided)));
        })(),
      openNote: (path) => void this.app.workspace.openLinkText(path, '', 'tab'),
    };
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
