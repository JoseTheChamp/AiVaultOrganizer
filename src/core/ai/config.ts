import * as z from 'zod';

/** Wire protocol of an endpoint; two clients cover nearly every provider (PLAN §7.1). */
export const PROVIDER_KINDS = ['openai-compatible', 'anthropic'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/**
 * Where and how to reach a model. Holds the *name* of a secret in Obsidian's SecretStorage, never
 * the key itself (invariant 6), so this object can live in data.json.
 */
export const endpointConfigSchema = z.object({
  kind: z.enum(PROVIDER_KINDS).default('openai-compatible'),
  /** Preset the user picked in settings (for display and defaults only). */
  preset: z.string().default('ollama'),
  baseUrl: z.string().trim().default('http://localhost:11434/v1'),
  model: z.string().trim().default(''),
  /** SecretStorage id of the API key; empty for keyless local servers. */
  secretName: z.string().trim().default(''),
  /** Overrides for what the endpoint can do; unknown endpoints are probed conservatively. */
  jsonSchema: z.boolean().default(true),
  toolCalling: z.boolean().default(true),
  maxContext: z.number().int().positive().default(8192),
});

export type EndpointConfig = z.infer<typeof endpointConfigSchema>;

export interface EndpointPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** A sensible model to suggest; the user can change it. */
  chatModel: string;
  embeddingModel: string | null;
  needsKey: boolean;
  /** Whether the endpoint is on this machine by default. */
  local: boolean;
  maxContext: number;
}

/**
 * Known endpoints. Free paths first: local servers need no key and send nothing anywhere. Cloud
 * free tiers may use inputs for training; the consent step warns before private notes go there.
 */
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', chatModel: 'qwen3:8b', embeddingModel: 'bge-m3', needsKey: false, local: true, maxContext: 8192 },
  { id: 'lm-studio', label: 'LM Studio (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', chatModel: '', embeddingModel: '', needsKey: false, local: true, maxContext: 8192 },
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', chatModel: 'gpt-4.1-mini', embeddingModel: 'text-embedding-3-small', needsKey: true, local: false, maxContext: 128000 },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', chatModel: 'claude-opus-5-5', embeddingModel: null, needsKey: true, local: false, maxContext: 200000 },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', chatModel: '', embeddingModel: null, needsKey: true, local: false, maxContext: 32000 },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', chatModel: 'gemini-2.5-flash', embeddingModel: 'text-embedding-004', needsKey: true, local: false, maxContext: 128000 },
  { id: 'mistral', label: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', chatModel: 'mistral-small-latest', embeddingModel: 'mistral-embed', needsKey: true, local: false, maxContext: 32000 },
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', chatModel: '', embeddingModel: null, needsKey: true, local: false, maxContext: 32000 },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai-compatible', baseUrl: '', chatModel: '', embeddingModel: '', needsKey: false, local: false, maxContext: 8192 },
];

export function findPreset(id: string): EndpointPreset | undefined {
  return ENDPOINT_PRESETS.find((preset) => preset.id === id);
}

/** Endpoint settings filled from a preset, keeping the user's secret name. */
export function configFromPreset(preset: EndpointPreset, purpose: 'chat' | 'embeddings', secretName = ''): EndpointConfig {
  return endpointConfigSchema.parse({
    kind: preset.kind,
    preset: preset.id,
    baseUrl: preset.baseUrl,
    model: purpose === 'chat' ? preset.chatModel : (preset.embeddingModel ?? ''),
    secretName: preset.needsKey ? secretName : '',
    maxContext: preset.maxContext,
  });
}

/**
 * The embedding endpoint that goes with a language model: the same provider, URL and key when that
 * provider offers embeddings, so one key is enough; otherwise a local Ollama model, which works next
 * to any language model (Anthropic, for example, has no embedding API).
 */
export function suggestEmbeddingEndpoint(chat: EndpointConfig): EndpointConfig {
  const preset = findPreset(chat.preset);
  if (preset?.kind === 'openai-compatible' && preset.embeddingModel !== null) {
    return endpointConfigSchema.parse({
      kind: preset.kind,
      preset: preset.id,
      baseUrl: chat.baseUrl,
      model: preset.embeddingModel,
      secretName: chat.secretName,
      maxContext: preset.maxContext,
    });
  }
  const ollama = findPreset('ollama');
  return ollama ? configFromPreset(ollama, 'embeddings') : endpointConfigSchema.parse({ model: 'bge-m3' });
}

/**
 * Whether the embedding endpoint is still the one suggested for `chat`. While it is, it follows
 * changes to the language model; once the user picks something else, it is left alone.
 */
export function followsLanguageModel(embeddings: EndpointConfig, chat: EndpointConfig): boolean {
  const suggested = suggestEmbeddingEndpoint(chat);
  return (
    embeddings.preset === suggested.preset &&
    trimBaseUrl(embeddings.baseUrl) === trimBaseUrl(suggested.baseUrl) &&
    embeddings.model === suggested.model &&
    embeddings.secretName === suggested.secretName
  );
}

/** Base URL without trailing slashes, for joining paths. */
export function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
