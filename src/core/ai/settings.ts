import * as z from 'zod';
import { configFromPreset, endpointConfigSchema, findPreset } from './config';

const defaultChat = () => {
  const preset = findPreset('ollama');
  return { enabled: false, ...(preset ? configFromPreset(preset, 'chat') : endpointConfigSchema.parse({})) };
};
const defaultEmbeddings = () => {
  const preset = findPreset('ollama');
  return { enabled: false, ...(preset ? configFromPreset(preset, 'embeddings') : endpointConfigSchema.parse({})) };
};

const endpointSetting = (fallback: () => z.infer<typeof endpointConfigSchema> & { enabled: boolean }) =>
  endpointConfigSchema.extend({ enabled: z.boolean().default(false) }).default(fallback).catch(fallback);

/**
 * AI settings as stored in data.json. Nothing here is secret: API keys stay in Obsidian's
 * SecretStorage and only their names appear (invariant 6). AI is off until the user enables it, and
 * local-only mode starts on, so the first cloud request is always a deliberate choice.
 */
export const aiSettingsSchema = z.object({
  chat: endpointSetting(defaultChat),
  embeddings: endpointSetting(defaultEmbeddings),
  localOnly: z.boolean().default(true).catch(true),
  /** Parallel requests; 0 picks a default (2 local, 4 cloud). */
  concurrency: z.number().int().min(0).max(16).default(0).catch(0),
  /** Requests per minute; 0 means no limit beyond the provider's own 429s. */
  requestsPerMinute: z.number().int().min(0).max(10_000).default(0).catch(0),
  /** Hard token ceiling for one run (a plan, an eval). */
  budgetTokens: z.number().int().min(1000).default(300_000).catch(300_000),
  /** Optional prices per million tokens, for cost estimates; never hard-coded. */
  inputPricePerMillion: z.number().min(0).optional().catch(undefined),
  outputPricePerMillion: z.number().min(0).optional().catch(undefined),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type EndpointSetting = AiSettings['chat'];
