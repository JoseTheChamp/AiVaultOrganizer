import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { ConsoleLogger } from './logger';
import { createServices, type PluginServices } from './services';
import { parseSettings, type PluginSettings } from './settings/settings';
import { SettingsTab } from './settings/settings-tab';

/** Entry point loaded by Obsidian. Wires adapters, commands and views; contains no domain logic. */
export default class AiVaultOrganizerPlugin extends Plugin {
  // Obsidian 1.13 types `Plugin.settings` as unknown and asks subclasses to narrow it.
  declare settings: PluginSettings;
  services!: PluginServices;
  /** True while a vault-changing task (apply, undo, backup) runs; they never overlap. */
  busy = false;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.services = createServices(this.app, new ConsoleLogger(() => this.settings.debugLogging));
    registerCommands(this);
    this.addSettingTab(new SettingsTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = parseSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
