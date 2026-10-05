/**
 * Provider-neutral contracts for language models and embeddings (PLAN §7.1). Two client families
 * implement them: OpenAI-compatible (Ollama, LM Studio, OpenAI, OpenRouter, Gemini, Mistral, Groq)
 * and Anthropic. Everything above the clients (structured output, retries, budgets, caching, the
 * planner) only sees these types. Model output never acts on the vault (invariant 3): it is parsed
 * and validated into data.
 */

/** A JSON Schema object, as produced by `z.toJSONSchema`. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments; `null` when the model produced invalid JSON (see `rawArguments`). */
  arguments: unknown;
  rawArguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for JSON matching this schema, enforced natively where the provider supports it. */
  schema?: { name: string; schema: JsonSchema; description?: string; strict?: boolean };
  /** Ask for any JSON object (fallback when schemas are not supported). */
  jsonMode?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required' | { name: string };
  /** Identifies the prompt for caching and reports; part of the cache key. */
  prompt?: { id: string; version: number };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  /** Text content (for structured output via tools: the JSON of the tool input). */
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  finishReason: string | null;
  /** True when served from the response cache. */
  cached?: boolean;
}

export interface ProviderCapabilities {
  /** Native JSON-schema-constrained output (response_format json_schema, forced tool use). */
  jsonSchema: boolean;
  toolCalling: boolean;
  embeddings: boolean;
  /** Context window in tokens. */
  maxContext: number;
  /** Runs on this machine; nothing leaves it. */
  local: boolean;
}

export interface ChatProvider {
  /** Stable description used in cache keys and reports, e.g. `openai-compatible:http://localhost:11434/v1`. */
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface EmbeddingResponse {
  vectors: Float32Array[];
  usage: Usage;
  model: string;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  embed(texts: string[]): Promise<EmbeddingResponse>;
}

/** Lists the models an endpoint serves; used by the connection test. */
export interface ModelLister {
  listModels(): Promise<string[]>;
}

export type ProviderErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'bad-request'
  | 'invalid-response'
  | 'blocked'
  | 'budget'
  /** The model declined the request (e.g. a safety classifier); retrying the same input won't help. */
  | 'refusal';

/** An expected failure talking to a provider; `retryable` decides whether backoff may help. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'rate-limit' || this.kind === 'server';
  }

  /** Maps an HTTP status to an error kind, reading Retry-After (seconds) when present. */
  static fromStatus(status: number, body: string, headers: Record<string, string> = {}): ProviderError {
    const detail = body.slice(0, 300).replace(/\s+/g, ' ').trim();
    const retryAfter = Number(headerValue(headers, 'retry-after'));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
    if (status === 401 || status === 403) return new ProviderError('auth', `Authentication failed (${status}). Check the API key. ${detail}`, status);
    if (status === 429) return new ProviderError('rate-limit', `Rate limited (429). ${detail}`, status, retryAfterMs);
    if (status >= 500) return new ProviderError('server', `Provider error (${status}). ${detail}`, status, retryAfterMs);
    return new ProviderError('bad-request', `Request rejected (${status}). ${detail}`, status);
  }
}

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}
