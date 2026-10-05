import { type App, normalizePath, Notice, PluginSettingTab, SecretComponent, Setting, type SettingDefinitionItem } from 'obsidian';
import { configFromPreset, ENDPOINT_PRESETS, findPreset } from '../../core/ai/config';
import { endpointPolicyProblem } from '../../core/ai/local-only';
import type { EndpointSetting } from '../../core/ai/settings';
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
    this.render();
  }

  private render(): void {
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

  /** Re-renders after a change that shows or hides rows (`update` on 1.13+, a full render before). */
  private refresh(): void {
    const update = (this as unknown as { update?: () => void }).update;
    if (typeof update === 'function') update.call(this);
    else this.render();
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
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
                    await this.save();
                  });
              });
            },
          },
        ],
      },
      { heading: 'Language model', rows: this.endpointRows('chat') },
      { heading: 'Embeddings', rows: this.endpointRows('embeddings') },
      {
        heading: 'Privacy and limits',
        rows: [
          {
            name: 'Local-only mode',
            desc: 'Blocks every request that would leave this computer. Turn it off only to use a cloud provider you trust with your notes.',
            render: (setting) => {
              setting.addToggle((toggle) => {
                toggle.setValue(settings.ai.localOnly).onChange(async (value) => {
                  settings.ai.localOnly = value;
                  await this.save();
                  this.refresh();
                });
              });
            },
          },
          {
            name: 'Parallel requests',
            desc: 'How many model calls run at once. 0 chooses automatically: 2 for local models, 4 for cloud providers.',
            render: (setting) => {
              setting.addSlider((slider) => {
                slider
                  .setLimits(0, 8, 1)
                  .setValue(settings.ai.concurrency)
                  .onChange(async (value) => {
                    settings.ai.concurrency = value;
                    await this.save();
                  });
              });
            },
          },
          {
            name: 'Requests per minute',
            desc: 'Optional limit for providers with strict rate limits. 0 means no limit.',
            render: (setting) => this.numberInput(setting, settings.ai.requestsPerMinute, (value) => (settings.ai.requestsPerMinute = value)),
          },
          {
            name: 'Token budget per run',
            desc: 'A run stops asking the model once it would use more tokens than this.',
            render: (setting) => this.numberInput(setting, settings.ai.budgetTokens, (value) => (settings.ai.budgetTokens = Math.max(1000, value))),
          },
          {
            name: 'Price per million tokens',
            desc: 'Optional input and output prices, used only to estimate costs before a run. Leave empty for local models.',
            render: (setting) => {
              for (const [placeholder, key] of [
                ['Input', 'inputPricePerMillion'],
                ['Output', 'outputPricePerMillion'],
              ] as const) {
                setting.addText((text) => {
                  text
                    .setPlaceholder(placeholder)
                    .setValue(settings.ai[key]?.toString() ?? '')
                    .onChange(async (value) => {
                      const parsed = Number(value.replace(',', '.'));
                      settings.ai[key] = value.trim() === '' || !Number.isFinite(parsed) || parsed < 0 ? undefined : parsed;
                      await this.save();
                    });
                });
              }
            },
          },
        ],
      },
      {
        heading: 'Backups',
        rows: [
          {
            name: 'Backups to keep',
            desc: 'A backup is created before every change to your vault. Older backups beyond this number are removed.',
            render: (setting) => {
              setting.addSlider((slider) => {
                slider
                  .setLimits(1, 50, 1)
                  .setValue(settings.backupRetention)
                  .onChange(async (value) => {
                    settings.backupRetention = value;
                    await this.save();
                  });
              });
            },
          },
          {
            name: 'Include attachments',
            desc: 'Also back up images, PDFs and other attachments. The plugin never changes them, so this is off by default to keep backups small.',
            render: (setting) => {
              setting.addToggle((toggle) => {
                toggle.setValue(settings.backupIncludeAttachments).onChange(async (value) => {
                  settings.backupIncludeAttachments = value;
                  await this.save();
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
                  await this.save();
                });
              });
            },
          },
          {
            name: 'Clear model response cache',
            desc: 'Cached answers make repeated plans free. Clear them to force fresh answers.',
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText('Clear cache').onClick(async () => {
                  const removed = await this.plugin.services.ai.clearCache();
                  new Notice(`Removed ${removed} cached responses.`);
                }),
              );
            },
          },
        ],
      },
    ];
  }

  /** Rows for one endpoint (chat or embeddings): on/off, provider, URL, model, key, test. */
  private endpointRows(purpose: 'chat' | 'embeddings'): RowSpec[] {
    const ai = this.plugin.settings.ai;
    const endpoint: EndpointSetting = ai[purpose];
    const isChat = purpose === 'chat';
    const presets = ENDPOINT_PRESETS.filter((preset) => isChat || (preset.embeddingModel !== null && preset.kind === 'openai-compatible'));
    const preset = findPreset(endpoint.preset);
    const rows: RowSpec[] = [
      {
        name: isChat ? 'Use a language model' : 'Use embeddings',
        desc: isChat
          ? 'Lets the planner ask a model where notes belong when no rule decides. Everything else works without it.'
          : 'Semantic similarity for link suggestions and placing notes by example. Without it, word statistics are used.',
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle.setValue(endpoint.enabled).onChange(async (value) => {
              endpoint.enabled = value;
              await this.save();
              this.refresh();
            });
          });
        },
      },
    ];
    if (!endpoint.enabled) return rows;

    rows.push(
      {
        name: 'Provider',
        desc: 'Local providers keep everything on this computer and need no key.',
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            for (const option of presets) dropdown.addOption(option.id, option.label);
            dropdown.setValue(endpoint.preset).onChange(async (value) => {
              const chosen = findPreset(value);
              if (!chosen) return;
              Object.assign(endpoint, configFromPreset(chosen, purpose, endpoint.secretName), { enabled: true });
              await this.save();
              this.refresh();
            });
          });
        },
      },
      {
        name: 'Endpoint',
        desc: endpointPolicyProblem(endpoint.baseUrl, ai.localOnly) ?? 'Base URL of the API.',
        render: (setting) => {
          setting.addText((text) => {
            text.setValue(endpoint.baseUrl).onChange(async (value) => {
              endpoint.baseUrl = value.trim();
              await this.save();
            });
          });
          if (endpointPolicyProblem(endpoint.baseUrl, ai.localOnly)) setting.descEl.addClass('avo-warning');
        },
      },
      {
        name: 'Model',
        desc: isChat ? 'A model that follows instructions and supports structured output.' : 'A multilingual embedding model works best for mixed-language vaults.',
        render: (setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder(isChat ? 'qwen3:8b' : 'bge-m3')
                .setValue(endpoint.model)
                .onChange(async (value) => {
                  endpoint.model = value.trim();
                  await this.save();
                });
            })
            .addButton((button) =>
              button.setButtonText('Test connection').onClick(async () => {
                button.setDisabled(true);
                try {
                  const report = await this.plugin.services.ai.testConnection(purpose);
                  new Notice(report.message, report.ok ? 5000 : 10_000);
                } finally {
                  button.setDisabled(false);
                }
              }),
            );
        },
      },
    );
    // Local servers never need a key; custom endpoints may (self-hosted proxies often do).
    if (preset?.local !== true || endpoint.secretName) {
      rows.push({
        name: 'API key',
        desc: "Choose or add a key in Obsidian's keychain. Only its name is saved in the plugin settings; the key never leaves this device except to this provider.",
        render: (setting) => {
          setting.addComponent((el) =>
            new SecretComponent(this.app, el).setValue(endpoint.secretName).onChange(async (value) => {
              endpoint.secretName = value;
              await this.save();
            }),
          );
        },
      });
    }
    return rows;
  }

  private numberInput(setting: Setting, value: number, apply: (value: number) => void): void {
    setting.addText((text) => {
      text.inputEl.type = 'number';
      text.setValue(String(value)).onChange(async (raw) => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        apply(Math.round(parsed));
        await this.save();
      });
    });
  }
}
