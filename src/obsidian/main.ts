import { Events, Notice, Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { ConsoleLogger } from './logger';
import { createServices, type PluginServices } from './services';
import { parseSettings, type PluginSettings } from './settings/settings';
import { SettingsTab } from './settings/settings-tab';
import type { Activity } from '../ui/activity';
import { openAiSetup } from './views/ai-setup-modal';
import { renderCharterBlock } from './views/charter-card';
import { DASHBOARD_VIEW, DashboardView } from './views/dashboard-view';
import { REVIEW_VIEW, ReviewView } from './views/review-view';

/** Entry point loaded by Obsidian. Wires adapters, commands and views; contains no domain logic. */
export default class AiVaultOrganizerPlugin extends Plugin {
  // Obsidian 1.13 types `Plugin.settings` as unknown and asks subclasses to narrow it.
  declare settings: PluginSettings;
  services!: PluginServices;
  /** True while a vault-changing task (apply, undo, backup) runs; they never overlap. */
  busy = false;
  /** Fires `changed` when the plugin's state may have changed: a run, an undo, a saved plan. */
  readonly changes = new Events();
  /** A long task in progress (organizing, indexing), for the dashboard; `activity` fires on change. */
  activity: Activity | null = null;
  private stopActivity: (() => void) | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.services = createServices(this.app, new ConsoleLogger(() => this.settings.debugLogging), () => this.settings);
    this.register(() => this.services.dispose());
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this));
    this.registerView(REVIEW_VIEW, (leaf) => new ReviewView(leaf, this));
    registerCommands(this);
    this.addRibbonIcon('layout-dashboard', 'Open vault organizer', () => void this.openDashboard());
    this.registerMarkdownCodeBlockProcessor('charter', (source, el) => renderCharterBlock(source, el));
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  /** Tells open views to refresh. */
  changed(): void {
    this.changes.trigger('changed');
  }

  /** Shows (or clears) a long task on the dashboard; `stop` is what its Stop button does. */
  setActivity(activity: Activity | null, stop?: () => void): void {
    this.activity = activity;
    this.stopActivity = stop ?? null;
    this.changes.trigger('activity');
  }

  /** The dashboard's Stop button. */
  stop(): void {
    this.stopActivity?.();
  }

  /** Reveals the dashboard in the right sidebar, opening it there once. */
  async openDashboard(): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(DASHBOARD_VIEW)[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
    await workspace.revealLeaf(leaf);
  }

  /** The guided AI setup; resolves true when a language model is set up and answers. */
  openAiSetup(): Promise<boolean> {
    return openAiSetup(this.app, this);
  }

  /**
   * Opens this plugin's settings tab. Obsidian has no public API for it; when the internal one is
   * missing, a notice says where to look instead.
   */
  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    if (setting) {
      setting.open();
      setting.openTabById(this.manifest.id);
    } else {
      new Notice('Open the settings and choose this plugin in the list on the left.');
    }
  }

  /** Opens a plan in the review view, reusing an open review. */
  async openReview(planId: string): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(REVIEW_VIEW)[0] ?? workspace.getLeaf('tab');
    await leaf.setViewState({ type: REVIEW_VIEW, active: true, state: { planId } });
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = parseSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
