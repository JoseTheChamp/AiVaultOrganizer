import { type App, normalizePath, Notice, PluginSettingTab, SecretComponent, Setting, type SettingDefinitionItem } from 'obsidian';
import {
  configFromPreset,
  ENDPOINT_PRESETS,
  type EndpointPreset,
  findPreset,
  followsLanguageModel,
  REASONING_LEVELS,
  type ReasoningLevel,
  suggestEmbeddingEndpoint,
  trimBaseUrl,
} from '../../core/ai/config';
import { endpointPolicyProblem } from '../../core/ai/local-only';
import type { EndpointSetting } from '../../core/ai/settings';
import type AiVaultOrganizerPlugin from '../main';

type Purpose = 'chat' | 'embeddings';

/** One settings row, rendered imperatively so the same spec serves both settings APIs. */
interface RowSpec {
  name: string;
  desc: string;
  render: (setting: Setting) => void;
  /** Indented under the toggle above it. */
  child?: boolean;
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
      for (const row of group.rows) renderRow(row, new Setting(containerEl).setName(row.name).setDesc(row.desc));
    }
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return this.groups().map((group) => ({
      type: 'group' as const,
      heading: group.heading,
      items: group.rows.map((row) => ({
        name: row.name,
        desc: row.desc,
        render: (setting: Setting) => renderRow(row, setting),
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
      { heading: 'AI', rows: [...this.languageModelRows(), ...this.similarityRows()] },
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
          {
            name: 'Similarity index',
            desc: 'Updated automatically as notes change. Reset it if similar notes look wrong; the next search rebuilds it.',
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText('Reset index').onClick(async () => {
                  await this.plugin.services.similarity.clear();
                  new Notice('The similarity index will be rebuilt on the next search.');
                }),
              );
            },
          },
        ],
      },
    ];
  }

  /** The language model: the main AI setting. */
  private languageModelRows(): RowSpec[] {
    const ai = this.plugin.settings.ai;
    const rows: RowSpec[] = [
      {
        name: 'Guided setup',
        desc: 'Choose where AI runs, add your key and test it in one step. The rows below hold every detail.',
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText('Set up AI')
              .setCta()
              .onClick(async () => {
                await this.plugin.openAiSetup();
                this.refresh();
              }),
          );
        },
      },
      {
        name: 'Use a language model',
        desc: 'Lets the planner ask a model where notes belong when no rule decides. Everything else works without it.',
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle.setValue(ai.chat.enabled).onChange(async (value) => {
              ai.chat.enabled = value;
              await this.save();
              this.refresh();
            });
          });
        },
      },
    ];
    if (!ai.chat.enabled) return rows;
    rows.push(
      this.providerRow('chat', ENDPOINT_PRESETS, 'Local providers keep everything on this computer and need no key.', (chosen) =>
        this.changeChat((chat) => Object.assign(chat, configFromPreset(chosen, 'chat', chat.secretName))),
      ),
      this.endpointRow('chat', (value) => this.changeChat((chat) => (chat.baseUrl = value))),
      this.modelRow('chat', 'Model', 'A model that follows instructions and supports structured output.', 'qwen3:8b'),
    );
    if (ai.chat.kind === 'openai-compatible') rows.push(this.thinkingRow());
    if (needsKeyRow(ai.chat)) rows.push(this.keyRow('chat', (value) => this.changeChat((chat) => (chat.secretName = value))));
    return rows;
  }

  /**
   * Embeddings, presented as an optional upgrade to similarity. They follow the language model's
   * provider (and key) until the user picks another, so most people never have to configure them.
   */
  private similarityRows(): RowSpec[] {
    const ai = this.plugin.settings.ai;
    const embeddings = ai.embeddings;
    const rows: RowSpec[] = [
      {
        name: 'Better similarity',
        desc: 'Finds related notes by meaning instead of shared words, even across languages. Needs an embedding model. Without it, word statistics are used, which need no setup.',
        render: (setting) => {
          setting.addToggle((toggle) => {
            toggle.setValue(embeddings.enabled).onChange(async (value) => {
              embeddings.enabled = value;
              await this.save();
              this.refresh();
            });
          });
        },
      },
    ];
    if (!embeddings.enabled) return rows;

    const chatPreset = findPreset(ai.chat.preset);
    let providerDesc = 'Local providers keep your notes on this computer.';
    if (ai.chat.enabled && chatPreset?.embeddingModel === null) {
      providerDesc = `${chatPreset.label} has no embedding model. A local one works with any language model.`;
    } else if (ai.chat.enabled && followsLanguageModel(embeddings, ai.chat)) {
      providerDesc = 'Uses the language model provider and its key.';
    }
    const presets = ENDPOINT_PRESETS.filter((preset) => preset.kind === 'openai-compatible' && preset.embeddingModel !== null);
    rows.push(
      this.providerRow('embeddings', presets, providerDesc, async (chosen) => {
        // Choosing the language model's provider again re-links to it (same URL and key).
        const next = chosen.id === ai.chat.preset ? suggestEmbeddingEndpoint(ai.chat) : configFromPreset(chosen, 'embeddings', embeddings.secretName);
        Object.assign(embeddings, next);
        await this.save();
      }),
    );
    const preset = findPreset(embeddings.preset);
    if (!preset || preset.id === 'custom' || trimBaseUrl(preset.baseUrl) !== trimBaseUrl(embeddings.baseUrl)) {
      rows.push(
        this.endpointRow('embeddings', async (value) => {
          embeddings.baseUrl = value;
          await this.save();
        }),
      );
    }
    rows.push(this.modelRow('embeddings', 'Embedding model', 'A multilingual model such as bge-m3 works best for vaults in more than one language.', 'bge-m3'));
    if (needsKeyRow(embeddings)) {
      rows.push(
        this.keyRow('embeddings', async (value) => {
          embeddings.secretName = value;
          await this.save();
        }),
      );
    }
    return rows;
  }

  /** Applies a change to the language model and carries it over to embeddings that follow it. */
  private async changeChat(apply: (chat: EndpointSetting) => void): Promise<void> {
    const ai = this.plugin.settings.ai;
    const following = followsLanguageModel(ai.embeddings, ai.chat);
    apply(ai.chat);
    if (following) Object.assign(ai.embeddings, suggestEmbeddingEndpoint(ai.chat));
    await this.save();
  }

  private providerRow(purpose: Purpose, presets: EndpointPreset[], desc: string, choose: (preset: EndpointPreset) => Promise<void>): RowSpec {
    const ai = this.plugin.settings.ai;
    const endpoint = ai[purpose];
    const problem = endpointPolicyProblem(endpoint.baseUrl, ai.localOnly);
    return {
      name: purpose === 'chat' ? 'Provider' : 'Embedding provider',
      desc: problem ?? desc,
      child: true,
      render: (setting) => {
        setting.addDropdown((dropdown) => {
          for (const option of presets) dropdown.addOption(option.id, option.label);
          dropdown.setValue(endpoint.preset).onChange(async (value) => {
            const chosen = findPreset(value);
            if (!chosen) return;
            await choose(chosen);
            this.refresh();
          });
        });
        if (problem) setting.descEl.addClass('avo-warning');
      },
    };
  }

  private endpointRow(purpose: Purpose, change: (value: string) => Promise<void>): RowSpec {
    const endpoint = this.plugin.settings.ai[purpose];
    return {
      name: 'Endpoint',
      desc: 'Base URL of the API.',
      child: true,
      render: (setting) => {
        setting.addText((text) => {
          text.setValue(endpoint.baseUrl).onChange((value) => change(value.trim()));
        });
      },
    };
  }

  private modelRow(purpose: Purpose, name: string, desc: string, placeholder: string): RowSpec {
    const endpoint = this.plugin.settings.ai[purpose];
    return {
      name,
      desc,
      child: true,
      render: (setting) => {
        setting
          .addText((text) => {
            text
              .setPlaceholder(placeholder)
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
    };
  }

  /** Reasoning level for thinking models (Qwen 3, DeepSeek R1, OpenAI o-series). */
  private thinkingRow(): RowSpec {
    const chat = this.plugin.settings.ai.chat;
    const labels: Record<ReasoningLevel, string> = { default: 'Model default', none: 'Off', low: 'Low', medium: 'Medium', high: 'High' };
    return {
      name: 'Thinking',
      desc: 'For models that reason before answering. Off answers much faster and is enough for sorting notes. Choose model default if your provider rejects the setting.',
      child: true,
      render: (setting) => {
        setting.addDropdown((dropdown) => {
          for (const level of REASONING_LEVELS) dropdown.addOption(level, labels[level]);
          dropdown.setValue(chat.reasoning).onChange(async (value) => {
            const level = REASONING_LEVELS.find((candidate) => candidate === value);
            if (!level) return;
            chat.reasoning = level;
            await this.save();
          });
        });
      },
    };
  }

  private keyRow(purpose: Purpose, change: (value: string) => Promise<void>): RowSpec {
    const endpoint = this.plugin.settings.ai[purpose];
    return {
      name: 'API key',
      desc: "Choose or add a key in Obsidian's keychain. Only its name is saved in the plugin settings; the key never leaves this device except to this provider.",
      child: true,
      render: (setting) => {
        setting.addComponent((el) => new SecretComponent(this.app, el).setValue(endpoint.secretName).onChange(change));
      },
    };
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

function renderRow(row: RowSpec, setting: Setting): void {
  if (row.child) setting.settingEl.addClass('avo-setting-child');
  row.render(setting);
}

/** Local servers never need a key; custom endpoints may (self-hosted proxies often do). */
function needsKeyRow(endpoint: EndpointSetting): boolean {
  return findPreset(endpoint.preset)?.local !== true || endpoint.secretName !== '';
}
