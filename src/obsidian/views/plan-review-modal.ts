import { type App, Modal, Setting } from 'obsidian';
import type { ValidationReport } from '../../core/apply/validate';
import { type Operation, type OperationKind, PHASE } from '../../core/model/operation';
import { describeOperation, KIND_LABELS } from '../../core/model/operation-text';
import type { Plan } from '../../core/model/plan';

export interface PlanReviewOptions {
  plan: Plan;
  validation: ValidationReport;
  /** False when Obsidian's "Automatically update internal links" is off. */
  linksAutoUpdate: boolean | null;
  onApply: (plan: Plan) => void;
}

/**
 * Minimal plan review: every proposed operation with a checkbox, grouped by kind, plus validation
 * issues. Unchecked operations become `rejected`. The full review view (filters, previews, bulk
 * accept by confidence) replaces this in the UI milestone.
 */
export class PlanReviewModal extends Modal {
  private readonly selected = new Set<string>();
  private acknowledgedLinks = false;

  constructor(
    app: App,
    private readonly options: PlanReviewOptions,
  ) {
    super(app);
    for (const op of options.plan.operations) {
      if (op.kind !== 'flag' && op.status !== 'rejected') this.selected.add(op.id);
    }
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { plan, validation } = this.options;
    this.setTitle('Review proposed changes');
    contentEl.addClass('avo-review');
    contentEl.createEl('p', {
      cls: 'avo-muted',
      text: `Plan ${plan.id}, created ${new Date(plan.createdAt).toLocaleString()}. Nothing changes until you apply. A backup is made first and every change can be undone.`,
    });

    for (const warning of plan.warnings) contentEl.createEl('p', { cls: 'avo-muted', text: warning.message });

    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    const warnings = validation.issues.filter((issue) => issue.severity === 'warning');
    if (errors.length > 0 || warnings.length > 0) {
      const list = contentEl.createEl('ul', { cls: 'avo-issues' });
      for (const issue of [...errors, ...warnings]) {
        list.createEl('li', { cls: issue.severity === 'error' ? 'avo-error' : 'avo-warning', text: issue.message });
      }
    }

    const hasMoves = plan.operations.some((op) => op.kind === 'move');
    if (hasMoves && this.options.linksAutoUpdate === false) {
      new Setting(contentEl)
        .setName('Links will not be updated')
        .setDesc(
          'Obsidian is set not to update internal links when files move, so moved notes would leave broken links. Turn the setting on in the app settings, or confirm to continue: the run stops and can be undone if links break.',
        )
        .addToggle((toggle) => toggle.setValue(false).onChange((value) => (this.acknowledgedLinks = value)));
    }

    const byKind = new Map<OperationKind, Operation[]>();
    for (const op of plan.operations) byKind.set(op.kind, [...(byKind.get(op.kind) ?? []), op]);
    for (const kind of [...byKind.keys()].sort((a, b) => PHASE[a] - PHASE[b])) {
      const ops = byKind.get(kind) ?? [];
      new Setting(contentEl).setName(`${KIND_LABELS[kind]} (${ops.length})`).setHeading();
      for (const op of ops) {
        const row = new Setting(contentEl).setName(describeOperation(op));
        const detail = [op.rationale, `${op.source}, confidence ${Math.round(op.confidence * 100)} %`].filter(Boolean).join(' · ');
        row.setDesc(detail);
        if (op.kind !== 'flag') {
          row.addToggle((toggle) =>
            toggle.setValue(this.selected.has(op.id)).onChange((value) => {
              if (value) this.selected.add(op.id);
              else this.selected.delete(op.id);
            }),
          );
        }
      }
    }

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText('Apply selected changes')
          .setCta()
          .setDisabled(!validation.ok)
          .onClick(() => {
            if (hasMoves && this.options.linksAutoUpdate === false && !this.acknowledgedLinks) return;
            this.close();
            this.options.onApply(this.decided());
          }),
      )
      .addButton((button) => button.setButtonText('Close').onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  /** The plan with review decisions: selected → accepted, the rest → rejected (flags untouched). */
  private decided(): Plan {
    const { plan } = this.options;
    return {
      ...plan,
      operations: plan.operations.map((op) =>
        op.kind === 'flag' ? op : { ...op, status: this.selected.has(op.id) ? ('accepted' as const) : ('rejected' as const) },
      ),
    };
  }
}
