import { type App, Modal, Setting } from 'obsidian';
import { DRIFT_KIND_LABELS, DRIFT_KINDS, type DriftReport, describeDrift } from '../../core/drift/drift';

export interface DriftModalOptions {
  report: DriftReport;
  onPlan: () => void;
}

/** Shows rule-based drift grouped by kind, with a way to plan the re-alignment. */
export class DriftModal extends Modal {
  constructor(
    app: App,
    private readonly options: DriftModalOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { report } = this.options;
    this.setTitle('Drift from your charter');
    contentEl.createEl('p', { text: describeDrift(report) });
    contentEl.createEl('p', { cls: 'avo-muted', text: `Checked against charter revision ${report.charterRevision}.` });

    for (const kind of DRIFT_KINDS) {
      const issues = report.issues.filter((issue) => issue.kind === kind);
      if (issues.length === 0) continue;
      new Setting(contentEl).setName(`${DRIFT_KIND_LABELS[kind]} (${issues.length})`).setHeading();
      const list = contentEl.createEl('ul', { cls: 'avo-issues' });
      for (const issue of issues.slice(0, 20)) list.createEl('li', { text: `${issue.path}: ${issue.detail}` });
      if (issues.length > 20) list.createEl('li', { cls: 'avo-muted', text: `…and ${issues.length - 20} more.` });
    }
    if (report.missingFolders.length > 0) {
      new Setting(contentEl).setName(`Folders to create (${report.missingFolders.length})`).setHeading();
      const list = contentEl.createEl('ul', { cls: 'avo-issues' });
      for (const folder of report.missingFolders) list.createEl('li', { text: folder });
    }

    const actionable = report.counts.misplaced + report.counts['missing-category'] + report.missingFolders.length > 0;
    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText('Organize')
          .setCta()
          .setDisabled(!actionable)
          .onClick(() => {
            this.close();
            this.options.onPlan();
          }),
      )
      .addButton((button) => button.setButtonText('Close').onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
