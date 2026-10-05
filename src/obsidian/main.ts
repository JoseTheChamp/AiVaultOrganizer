import { Plugin } from 'obsidian';
import { webCryptoHasher } from '../core/hash';
import { type Logger, systemClock, type VaultReader } from '../core/ports';
import { ObsidianVaultReader } from './adapters/obsidian-vault-reader';
import { registerCommands } from './commands';
import { ConsoleLogger } from './logger';
import { parseSettings, type PluginSettings } from './settings/settings';
import { SettingsTab } from './settings/settings-tab';

/** Adapters wired once per plugin load; commands and views receive them from here. */
export interface PluginServices {
  reader: VaultReader;
  logger: Logger;
}

/** Entry point loaded by Obsidian. Wires adapters, commands and views; contains no domain logic. */
export default class AiVaultOrganizerPlugin extends Plugin {
  // Obsidian 1.13 types `Plugin.settings` as unknown and asks subclasses to narrow it.
  declare settings: PluginSettings;
  services!: PluginServices;

  override async onload(): Promise<void> {
    await this.loadSettings();
    const logger = new ConsoleLogger(() => this.settings.debugLogging);
    this.services = {
      reader: new ObsidianVaultReader(this.app, webCryptoHasher, systemClock),
      logger,
    };
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
