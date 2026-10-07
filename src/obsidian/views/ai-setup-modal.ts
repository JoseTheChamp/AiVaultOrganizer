import { type App, Modal, Notice, Setting } from 'obsidian';
import { findPreset } from '../../core/ai/config';
import { hostOf } from '../../core/ai/endpoint-url';
import { type AiSetup, applyAiSetup, CLOUD_PROVIDERS, currentSetup, LOCAL_PROVIDERS, secretNameFor } from '../../core/ai/setup';
import type AiVaultOrganizerPlugin from '../main';

type Mode = AiSetup['mode'];

const MODES: { mode: Mode; title: string; detail: string }[] = [
  { mode: 'local', title: 'On this computer', detail: 'Free and private. Needs Ollama or LM Studio.' },
  { mode: 'cloud', title: 'With my API key', detail: 'OpenAI, Anthropic, Gemini and others. Paid per use.' },
  { mode: 'none', title: 'No AI', detail: 'Rules and similar notes only.' },
];

/**
 * Guided AI setup: where the model runs, which one, the key if it needs one, and a connection
 * test, in one dialog. Keys go into Obsidian's keychain; only their name is stored in the settings.
 * The settings tab keeps every detail (custom endpoints, limits, prices).
 */
class AiSetupModal extends Modal {
  private mode: Mode;
  private local = { preset: 'ollama', model: 'qwen3:8b', similarity: false };
  private cloud = { preset: 'openai', model: '' };
  /** A pasted key, held only until it is saved to the keychain. */
  private key = '';
  private status: { text: string; error: boolean } | null = null;
  private busy = false;
  private ready = false;

  constructor(
    app: App,
    private readonly plugin: AiVaultOrganizerPlugin,
    private readonly resolve: (ready: boolean) => void,
  ) {
    super(app);
    const current = currentSetup(plugin.settings.ai);
    this.mode = current.mode;
    if (current.mode === 'local') this.local = { preset: current.preset, model: current.model, similarity: current.similarity };
    if (current.mode === 'cloud') this.cloud = { preset: current.preset, model: current.model };
  }

  override onOpen(): void {
    this.setTitle('Set up AI');
    this.modalEl.addClass('avo-ai-setup');
    this.render();
  }

  override onClose(): void {
    this.key = '';
    this.contentEl.empty();
    this.resolve(this.ready);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { cls: 'avo-muted', text: 'AI sorts the notes your rules cannot place, and can suggest a system for your vault. Everything else works without it.' });

    const modes = contentEl.createDiv({ cls: 'avo-ai-modes', attr: { role: 'radiogroup', 'aria-label': 'Where AI runs' } });
    for (const option of MODES) {
      const button = modes.createEl('button', { cls: ['avo-ai-mode', ...(option.mode === this.mode ? ['is-selected'] : [])], attr: { type: 'button', role: 'radio', 'aria-checked': String(option.mode === this.mode) } });
      button.createEl('strong', { text: option.title });
      button.createSpan({ cls: 'avo-muted', text: option.detail });
      button.addEventListener('click', () => {
        this.mode = option.mode;
        this.status = null;
        this.render();
      });
    }

    if (this.mode === 'local') this.renderLocal(contentEl);
    if (this.mode === 'cloud') this.renderCloud(contentEl);
    if (this.mode === 'none') {
      contentEl.createEl('p', { text: 'Charter rules and similar notes still place notes. Notes they cannot place are flagged for you to file.' });
    }

    if (this.status) contentEl.createEl('p', { cls: this.status.error ? 'avo-error' : 'avo-muted', text: this.status.text, attr: { role: 'status' } });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText('All AI settings').onClick(() => this.plugin.openSettings()))
      .addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(this.mode === 'none' ? 'Save' : 'Save and test')
          .setCta()
          .setDisabled(this.busy)
          .onClick(() => void this.save()),
      );
  }

  private renderLocal(el: HTMLElement): void {
    new Setting(el).setName('App').addDropdown((dropdown) => {
      for (const preset of LOCAL_PROVIDERS) dropdown.addOption(preset.id, preset.label);
      dropdown.setValue(this.local.preset).onChange((value) => {
        this.local.preset = value;
        this.local.model = findPreset(value)?.chatModel ?? '';
        this.render();
      });
    });
    const install = this.local.preset === 'ollama' ? 'Install Ollama from ollama.com, then run "ollama pull qwen3:8b" once.' : 'Load a model in LM Studio and start its local server.';
    new Setting(el)
      .setName('Model')
      .setDesc(install)
      .addText((text) => text.setPlaceholder(findPreset(this.local.preset)?.chatModel ?? '').setValue(this.local.model).onChange((value) => (this.local.model = value)));
    const embedding = findPreset(this.local.preset)?.embeddingModel;
    if (embedding) {
      new Setting(el)
        .setName('Also compare notes by meaning')
        .setDesc(`Finds similar notes better, even across languages. Run "ollama pull ${embedding}" once.`)
        .addToggle((toggle) => toggle.setValue(this.local.similarity).onChange((value) => (this.local.similarity = value)));
    }
  }

  private renderCloud(el: HTMLElement): void {
    const preset = findPreset(this.cloud.preset);
    new Setting(el).setName('Provider').addDropdown((dropdown) => {
      for (const option of CLOUD_PROVIDERS) dropdown.addOption(option.id, option.label);
      dropdown.setValue(this.cloud.preset).onChange((value) => {
        this.cloud.preset = value;
        this.cloud.model = findPreset(value)?.chatModel ?? '';
        this.key = '';
        this.render();
      });
    });
    const saved = this.app.secretStorage.getSecret(secretNameFor(this.cloud.preset)) !== null;
    new Setting(el)
      .setName('API key')
      .setDesc(saved ? 'A key is saved in Obsidian\'s keychain on this device. Paste a new one to replace it.' : 'Stored in Obsidian\'s keychain on this device, never in the plugin settings.')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text.setPlaceholder(saved ? 'Saved' : 'Paste your key').onChange((value) => (this.key = value.trim()));
      });
    new Setting(el)
      .setName('Model')
      .setDesc(preset?.chatModel ? 'The suggested model is a good default.' : 'Enter the model name from your provider.')
      .addText((text) => text.setPlaceholder(preset?.chatModel ?? '').setValue(this.cloud.model).onChange((value) => (this.cloud.model = value)));
    el.createEl('p', { cls: 'avo-muted', text: `Notes are sent to ${hostOf(preset?.baseUrl ?? '')} only after you agree, each time, and private notes never are.` });
  }

  private async save(): Promise<void> {
    const { plugin } = this;
    let setup: AiSetup;
    if (this.mode === 'local') setup = { mode: 'local', ...this.local };
    else if (this.mode === 'cloud') {
      const secretName = secretNameFor(this.cloud.preset);
      if (this.key) this.app.secretStorage.setSecret(secretName, this.key);
      this.key = '';
      if (this.app.secretStorage.getSecret(secretName) === null) {
        this.status = { text: 'Paste your API key first.', error: true };
        this.render();
        return;
      }
      setup = { mode: 'cloud', preset: this.cloud.preset, model: this.cloud.model, secretName };
    } else setup = { mode: 'none' };

    plugin.settings.ai = applyAiSetup(plugin.settings.ai, setup);
    await plugin.saveSettings();
    plugin.changed();
    if (setup.mode === 'none') {
      this.close();
      return;
    }

    this.busy = true;
    this.status = { text: 'Testing the connection…', error: false };
    this.render();
    try {
      const report = await plugin.services.ai.testConnection('chat');
      const model = plugin.settings.ai.chat.model;
      const missing = report.ok && setup.mode === 'local' && report.models.length > 0 && !report.models.some((name) => name === model || name === `${model}:latest`);
      if (report.ok && !missing) {
        this.ready = true;
        new Notice(`AI is ready: ${model}.`);
        this.close();
        return;
      }
      this.status = missing
        ? { text: `The app runs, but "${model}" is not installed. Installed: ${report.models.slice(0, 6).join(', ')}.`, error: true }
        : { text: report.message, error: true };
    } finally {
      this.busy = false;
    }
    this.render();
  }
}

/** Opens the guided AI setup; resolves true when a language model is set up and answers. */
export function openAiSetup(app: App, plugin: AiVaultOrganizerPlugin): Promise<boolean> {
  return new Promise((resolve) => new AiSetupModal(app, plugin, resolve).open());
}
