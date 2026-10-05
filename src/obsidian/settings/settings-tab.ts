import { type App, normalizePath, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type AiVaultOrganizerPlugin from '../main';

/** One settings row, rendered imperatively so the same spec serves both settings APIs. */
interface RowSpec {
  name: string;
  desc: string;
  render: (setting: Setting) => void;
}

interface GroupSpec {
  heading: string;
  rows: RowSpec[];
}

/**
 * Settings tab. Rows are declared once as specs and rendered either through `display()`
 * (Obsidian < 1.13) or through `getSettingDefinitions()` (1.13+, which also makes them searchable).
 */
export class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AiVaultOrganizerPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const group of this.groups()) {
      new Setting(containerEl).setName(group.heading).setHeading();
      for (const row of group.rows) {
        row.render(new Setting(containerEl).setName(row.name).setDesc(row.desc));
      }
    }
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return this.groups().map((group) => ({
      type: 'group' as const,
      heading: group.heading,
      items: group.rows.map((row) => ({
        name: row.name,
        desc: row.desc,
        render: (setting: Setting) => row.render(setting),
      })),
    }));
  }

  private groups(): GroupSpec[] {
    const settings = this.plugin.settings;
    return [
      {
        heading: 'Charter',
        rows: [
          {
            name: 'Charter note',
            desc: 'Path of the note that describes how this vault is organized.',
            render: (setting) => {
              setting.addText((text) => {
                text
                  .setPlaceholder('Vault Charter.md')
                  .setValue(settings.charterPath)
                  .onChange(async (value) => {
                    const trimmed = value.trim();
                    if (trimmed.length === 0) return;
                    settings.charterPath = normalizePath(trimmed);
                    await this.plugin.saveSettings();
                  });
              });
            },
          },
        ],
      },
      {
        heading: 'Advanced',
        rows: [
          {
            name: 'Debug logging',
            desc: 'Write detailed diagnostics to the developer console. Note contents are never logged.',
            render: (setting) => {
              setting.addToggle((toggle) => {
                toggle.setValue(settings.debugLogging).onChange(async (value) => {
                  settings.debugLogging = value;
                  await this.plugin.saveSettings();
                });
              });
            },
          },
        ],
      },
    ];
  }
}
