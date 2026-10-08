import type { Clock, Hasher, HttpPort, SecretsPort, StoragePort } from '../ports';
import { AnthropicClient } from './anthropic';
import { BudgetedChatProvider, type RunBudget } from './budget';
import { CachedChatProvider, ResponseCache } from './cache';
import type { EndpointConfig } from './config';
import { endpointPolicyProblem, LocalOnlyHttp } from './local-only';
import { OpenAICompatibleClient } from './openai-compatible';
import { ConcurrencyPool, defaultConcurrency, ResilientChatProvider, ResilientEmbeddingProvider, type Sleep, TokenBucket } from './resilience';
import type { AiSettings } from './settings';
import { type ChatProvider, type EmbeddingProvider, type ModelLister, ProviderError } from './types';

export interface AiDeps {
  /** The raw transport (requestUrl in Obsidian, fetch or cassettes in Node). */
  http: HttpPort;
  secrets: SecretsPort;
  storage: StoragePort;
  hasher: Hasher;
  clock: Clock;
  sleep: Sleep;
}

function client(config: EndpointConfig, settings: AiSettings, deps: AiDeps): ChatProvider & ModelLister {
  const http = new LocalOnlyHttp(deps.http, () => settings.localOnly);
  return config.kind === 'anthropic' ? new AnthropicClient(config, { http, secrets: deps.secrets }) : new OpenAICompatibleClient(config, { http, secrets: deps.secrets });
}

function resilience(settings: AiSettings, deps: AiDeps, local: boolean) {
  return {
    pool: new ConcurrencyPool(settings.concurrency > 0 ? settings.concurrency : defaultConcurrency(local)),
    retry: { retries: 3, baseDelayMs: 1000, maxDelayMs: 30_000, sleep: deps.sleep },
    bucket:
      settings.requestsPerMinute > 0
        ? new TokenBucket({ capacity: settings.requestsPerMinute, perMinute: settings.requestsPerMinute, clock: deps.clock, sleep: deps.sleep })
        : undefined,
  };
}

/**
 * The chat provider stack for the current settings, or null when the language model is off:
 * local-only guard → client → concurrency, rate limit and retries → run budget → response cache.
 * The cache sits outermost so cache hits cost no budget.
 */
export function createChatProvider(settings: AiSettings, deps: AiDeps, options: { budget?: RunBudget; cache?: boolean } = {}): ChatProvider | null {
  if (!settings.chat.enabled || !settings.chat.model) return null;
  const base = client(settings.chat, settings, deps);
  let provider: ChatProvider = new ResilientChatProvider(base, resilience(settings, deps, base.capabilities.local));
  if (options.budget) provider = new BudgetedChatProvider(provider, options.budget);
  if (options.cache ?? true) provider = new CachedChatProvider(provider, new ResponseCache(deps.storage, deps.hasher));
  return provider;
}

export function createEmbeddingProvider(settings: AiSettings, deps: AiDeps): EmbeddingProvider | null {
  const config = settings.embeddings;
  if (!config.enabled || !config.model || config.kind !== 'openai-compatible') return null;
  const http = new LocalOnlyHttp(deps.http, () => settings.localOnly);
  const base = new OpenAICompatibleClient(config, { http, secrets: deps.secrets });
  return new ResilientEmbeddingProvider(base, resilience(settings, deps, base.capabilities.local));
}

export interface ConnectionReport {
  ok: boolean;
  /** One sentence for a notice. */
  message: string;
  models: string[];
  latencyMs: number | null;
}

/**
 * Settings "Test connection": lists the endpoint's models, checks the configured model exists, and
 * (for chat) sends a tiny request. Never cached, never retried, and subject to local-only mode.
 */
export async function testConnection(purpose: 'chat' | 'embeddings', settings: AiSettings, deps: AiDeps): Promise<ConnectionReport> {
  const config = settings[purpose];
  const policy = endpointPolicyProblem(config.baseUrl, settings.localOnly);
  if (policy) return { ok: false, message: policy, models: [], latencyMs: null };
  const target = client(config, settings, deps);
  try {
    const models = await target.listModels().catch((error: unknown) => {
      // Some compatible servers don't implement the model list; the request below still decides.
      if (error instanceof ProviderError && (error.kind === 'bad-request' || error.kind === 'invalid-response')) return [] as string[];
      throw error;
    });
    if (!config.model) return { ok: false, message: `Connected. Choose a model: ${preview(models)}.`, models, latencyMs: null };
    if (models.length > 0 && !models.includes(config.model)) {
      return { ok: false, message: `Connected, but "${config.model}" is not available. Available: ${preview(models)}.`, models, latencyMs: null };
    }
    const started = deps.clock.now();
    if (purpose === 'chat') {
      await target.chat({ messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 16 });
    } else if (target instanceof OpenAICompatibleClient) {
      await target.embed(['connection test']);
    }
    const latencyMs = deps.clock.now() - started;
    return { ok: true, message: `Connected to ${config.model} (${latencyMs} ms).`, models, latencyMs };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, message: error.message, models: [], latencyMs: null };
    throw error;
  }
}

/** Whether the language model can be used right now, for the dashboard's status light. */
export type AiStatus =
  | { state: 'off' }
  /** Local-only mode forbids the configured (cloud) host. */
  | { state: 'blocked'; message: string }
  | { state: 'online'; model: string; latencyMs: number }
  /** The server answers but does not have the configured model. */
  | { state: 'missing-model'; model: string; available: string[] }
  | { state: 'offline'; message: string };

/**
 * A cheap check that the language model is reachable: only the provider's model list, which costs
 * no tokens, never a chat request. A server without a model list counts as online if it answers.
 */
export async function checkStatus(settings: AiSettings, deps: AiDeps): Promise<AiStatus> {
  const config = settings.chat;
  if (!config.enabled || !config.model) return { state: 'off' };
  const policy = endpointPolicyProblem(config.baseUrl, settings.localOnly);
  if (policy) return { state: 'blocked', message: policy };
  const started = deps.clock.now();
  try {
    const models = await client(config, settings, deps)
      .listModels()
      .catch((error: unknown) => {
        if (error instanceof ProviderError && (error.kind === 'bad-request' || error.kind === 'invalid-response')) return null;
        throw error;
      });
    const latencyMs = deps.clock.now() - started;
    if (models && models.length > 0 && !models.some((name) => name === config.model || name === `${config.model}:latest`)) {
      return { state: 'missing-model', model: config.model, available: models };
    }
    return { state: 'online', model: config.model, latencyMs };
  } catch (error) {
    if (error instanceof ProviderError) return { state: 'offline', message: error.message };
    throw error;
  }
}

function preview(models: string[]): string {
  if (models.length === 0) return 'none listed';
  return models.length > 8 ? `${models.slice(0, 8).join(', ')} …` : models.join(', ');
}
