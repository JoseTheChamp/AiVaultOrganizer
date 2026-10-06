import { Events, Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { ConsoleLogger } from './logger';
import { createServices, type PluginServices } from './services';
import { parseSettings, type PluginSettings } from './settings/settings';
import { SettingsTab } from './settings/settings-tab';
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

  /** Reveals the dashboard in the right sidebar, opening it there once. */
  async openDashboard(): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(DASHBOARD_VIEW)[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
    await workspace.revealLeaf(leaf);
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
