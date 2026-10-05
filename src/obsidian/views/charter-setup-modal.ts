import { type App, Modal, Setting } from 'obsidian';
import type { VaultAnalysis } from '../../core/analysis/analyze';
import { describeDetection } from '../../core/analysis/method-detect';
import { adaptPresetToVault, inferCharter } from '../../core/charter/infer';
import { type Lang, PRESET_ORDER, presetCharter, toLang } from '../../core/charter/presets/index';
import type { Charter } from '../../core/charter/schema';
import { computeDrift } from '../../core/drift/drift';
import { METHOD_LABELS, type MethodId } from '../../core/model/methods';
import type { VaultSnapshot } from '../../core/model/note';
import { plural } from '../../core/model/text';

type Choice = MethodId | 'codify';

export interface CharterSetupOptions {
  snapshot: VaultSnapshot;
  analysis: VaultAnalysis;
  existing: Charter | null;
  /** The existing charter's rules are invalid and will be replaced. */
  replacesInvalid: boolean;
  charterPath: string;
  onSubmit: (charter: Charter, planMoves: boolean) => void;
}

/**
 * Charter setup without AI (§2.1 steps 1–4): shows what was detected, lets the user pick a method
 * (or codify the current structure) and a language, previews the destinations and what the rules
 * would do to the vault, and hands the chosen charter back. Nothing is written here.
 */
export class CharterSetupModal extends Modal {
  private choice: Choice;
  private lang: Lang;
  private planMoves = true;
  private readonly recommended: Choice;

  constructor(
    app: App,
    private readonly options: CharterSetupOptions,
  ) {
    super(app);
    const dominant = options.analysis.methods.dominant;
    this.recommended = dominant === 'none' || dominant === 'mixed' || dominant === 'topics' ? 'codify' : dominant;
    this.choice = options.existing && options.existing.preset !== 'custom' ? options.existing.preset : this.recommended;
    this.lang = options.existing ? toLang(options.existing.language) : options.analysis.stats.language.language;
  }

  override onOpen(): void {
    this.setTitle(this.options.existing ? 'Update your vault charter' : 'Set up your vault charter');
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private charter(): Charter {
    const { snapshot, analysis } = this.options;
    return this.choice === 'codify' ? inferCharter(snapshot, analysis, this.lang) : adaptPresetToVault(presetCharter(this.choice, this.lang), snapshot);
  }

  private render(): void {
    const { contentEl, options } = this;
    contentEl.empty();
    contentEl.addClass('avo-setup');
    const label = (choice: Choice) => (choice === 'codify' ? 'Keep my current structure' : METHOD_LABELS[choice]);

    contentEl.createEl('p', {
      text: `${describeDetection(options.analysis.methods)} Recommended: ${label(this.recommended)}.`,
    });
    contentEl.createEl('p', {
      cls: 'avo-muted',
      text: `The charter is a note ("${options.charterPath}") that explains your system and holds the rules the plugin follows. You can edit it any time.`,
    });
    if (options.replacesInvalid) {
      contentEl.createEl('p', { cls: 'avo-warning', text: 'Your current charter rules have errors; saving replaces them. A backup is made first.' });
    }

    new Setting(contentEl)
      .setName('Organization method')
      .setDesc('Choose a known method, or describe the folders you already have.')
      .addDropdown((dropdown) => {
        for (const choice of ['codify', ...PRESET_ORDER] as Choice[]) {
          dropdown.addOption(choice, `${label(choice)}${choice === this.recommended ? ' (recommended)' : ''}`);
        }
        dropdown.setValue(this.choice).onChange((value) => {
          this.choice = value as Choice;
          this.render();
        });
      });
    new Setting(contentEl)
      .setName('Language')
      .setDesc('Used for folder names and the charter text.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ en: 'English', cs: 'Čeština' })
          .setValue(this.lang)
          .onChange((value) => {
            this.lang = value as Lang;
            this.render();
          }),
      );

    const charter = this.charter();
    new Setting(contentEl).setName('Destinations').setHeading();
    const list = contentEl.createEl('ul', { cls: 'avo-issues' });
    if (charter.inbox) list.createEl('li', { text: `${charter.inbox}: inbox for unprocessed notes` });
    for (const destination of charter.destinations) {
      list.createEl('li', { text: `${destination.path ?? destination.category ?? destination.id}: ${destination.description || destination.id}` });
    }
    if (charter.system.daily) list.createEl('li', { text: `${charter.system.daily.path}: daily notes (${charter.system.daily.filename})` });

    const drift = computeDrift(options.snapshot, charter, { charterPath: options.charterPath, now: Date.now() });
    const moves = drift.counts.misplaced + drift.counts['missing-category'];
    contentEl.createEl('p', {
      cls: 'avo-muted',
      text: `With this charter, ${plural(drift.noteCount - drift.offCharter, 'note')} already fit. The rules would move ${plural(moves, 'note')}; ${plural(drift.counts.unplaced, 'note')} would stay outside every destination for you or the classifier to file.`,
    });

    new Setting(contentEl)
      .setName('Propose moves after saving')
      .setDesc('Opens the review of what the rules imply. Nothing moves until you apply it.')
      .addToggle((toggle) => toggle.setValue(this.planMoves).onChange((value) => (this.planMoves = value)));

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(options.existing ? 'Update charter' : 'Create charter')
          .setCta()
          .onClick(() => {
            this.close();
            options.onSubmit(charter, this.planMoves);
          }),
      )
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
  }
}
