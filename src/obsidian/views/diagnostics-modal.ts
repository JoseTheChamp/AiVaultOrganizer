import { type App, Modal, Notice, Setting } from 'obsidian';
import type { VaultAnalysis } from '../../core/analysis/analyze';
import { describeDetection } from '../../core/analysis/method-detect';
import { plural } from '../../core/model/text';
import { formatAnalysisMarkdown } from '../../core/analysis/report';
import { METHOD_LABELS } from '../../core/model/methods';

const percent = (value: number): string => `${Math.round(value * 100)} %`;

/** Shows the tier 0 diagnostics of `Analyze vault`. Read-only: it proposes nothing yet. */
export class DiagnosticsModal extends Modal {
  constructor(
    app: App,
    private readonly analysis: VaultAnalysis,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { stats, methods, health, triage } = this.analysis;
    this.setTitle('Vault diagnostics');
    contentEl.addClass('avo-diagnostics');

    const header = contentEl.createDiv({ cls: 'avo-score-header' });
    const scoreEl = header.createDiv({ cls: `avo-score avo-score-${health.grade}` });
    scoreEl.createSpan({ cls: 'avo-score-value', text: String(health.score) });
    scoreEl.createSpan({ cls: 'avo-score-label', text: 'Health score' });
    const summary = header.createDiv({ cls: 'avo-score-summary' });
    summary.createEl('p', { text: describeDetection(methods) });
    summary.createEl('p', {
      cls: 'avo-muted',
      text: `${stats.noteCount} notes · ${stats.folderCount} folders · ${stats.attachmentCount} attachments · ${stats.graph.edgeCount} links`,
    });

    new Setting(contentEl).setName('Organization method').setHeading();
    for (const score of methods.scores) {
      this.meterRow(contentEl, METHOD_LABELS[score.method], score.score, score.reasons.join(' ') || 'No signals found.');
    }

    new Setting(contentEl).setName('Health').setHeading();
    for (const component of health.components.filter((c) => c.weight > 0)) {
      this.meterRow(contentEl, component.label, component.value, component.detail);
    }

    if (stats.tags.variantGroups.length > 0 || stats.emptyFolders.length > 0 || triage.stubs.length > 0) {
      new Setting(contentEl).setName('Things to look at').setHeading();
      const list = contentEl.createEl('ul', { cls: 'avo-issues' });
      for (const group of stats.tags.variantGroups.slice(0, 5)) {
        list.createEl('li', {
          text: `Tag spelled ${group.variants.length} ways: ${group.variants.map((v) => `#${v.tag} (${v.count})`).join(', ')}`,
        });
      }
      for (const folder of stats.emptyFolders.slice(0, 5)) {
        list.createEl('li', { text: `Empty folder: ${folder}` });
      }
      for (const stub of triage.stubs.slice(0, 5)) {
        list.createEl('li', { text: `Stub with ${plural(stub.words, 'word')}: ${stub.path}` });
      }
      if (triage.stubs.length > 5) list.createEl('li', { cls: 'avo-muted', text: `…and ${plural(triage.stubs.length - 5, 'more stub')}.` });
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText('Copy report').onClick(async () => {
          await navigator.clipboard.writeText(formatAnalysisMarkdown(this.analysis));
          new Notice('Diagnostics copied as Markdown.');
        }),
      )
      .addButton((button) => button.setButtonText('Close').setCta().onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private meterRow(parent: HTMLElement, label: string, value: number, detail: string): void {
    const row = parent.createDiv({ cls: 'avo-meter-row' });
    const top = row.createDiv({ cls: 'avo-meter-top' });
    top.createSpan({ cls: 'avo-meter-label', text: label });
    top.createSpan({ cls: 'avo-meter-value', text: percent(value) });
    row.createEl('meter', { cls: 'avo-meter', attr: { min: 0, max: 1, low: 0.5, high: 0.75, optimum: 1, value } });
    row.createDiv({ cls: 'avo-muted avo-meter-detail', text: detail });
  }
}
