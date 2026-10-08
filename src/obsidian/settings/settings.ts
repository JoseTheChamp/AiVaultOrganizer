import * as z from 'zod';
import { aiSettingsSchema } from '../../core/ai/settings';

/**
 * Persisted plugin settings (`data.json`). Never holds secrets: API keys live in Obsidian's
 * SecretStorage and only the secret's *name* is stored here.
 *
 * Every field has a default and a `.catch()` fallback, so a hand-edited or outdated `data.json`
 * degrades field by field instead of resetting everything.
 */
export const settingsSchema = z.object({
  charterPath: z.string().trim().min(1).default('Vault Charter.md').catch('Vault Charter.md'),
  /** Backups kept in .ai-vault-organizer/backups; older ones are pruned after each run. */
  backupRetention: z.number().int().min(1).max(100).default(10).catch(10),
  backupIncludeAttachments: z.boolean().default(false).catch(false),
  ai: aiSettingsSchema.default(() => aiSettingsSchema.parse({})).catch(() => aiSettingsSchema.parse({})),
  debugLogging: z.boolean().default(false).catch(false),
  /**
   * How fast each language model placed notes on its last run (ms per note, keyed by
   * `paceKey`), so the next run can say how long it may take. A local model may need minutes.
   */
  modelPace: z.record(z.string(), z.number().positive()).default({}).catch({}),
});

export type PluginSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: PluginSettings = settingsSchema.parse({});

/** The key of a model's pace: the same model behind another endpoint runs at another speed. */
export function paceKey(chat: { baseUrl: string; model: string }): string {
  return `${chat.model} @ ${chat.baseUrl}`;
}

export function parseSettings(raw: unknown): PluginSettings {
  const input = typeof raw === 'object' && raw !== null ? raw : {};
  return settingsSchema.parse(input);
}
