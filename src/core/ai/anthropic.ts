import * as z from 'zod';
import { type EndpointConfig, trimBaseUrl } from './config';
import { isLoopbackUrl } from './endpoint-url';
import type { ClientDeps } from './openai-compatible';
import {
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  type JsonSchema,
  type ModelLister,
  type ProviderCapabilities,
  ProviderError,
  type ToolCall,
} from './types';

const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 16_000;
/** System prompts longer than this are marked for prompt caching (classification batches reuse them). */
const CACHE_SYSTEM_CHARS = 4_000;
/**
 * Models that accept server-side refusal fallbacks: when a safety classifier declines a request,
 * the API re-runs it on a recommended model instead of failing the batch.
 */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const blockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.string() }).loose(),
]);

const messageResponseSchema = z.object({
  model: z.string().optional(),
  content: z.array(blockSchema),
  stop_reason: z.string().nullable().optional(),
  stop_details: z.object({ category: z.string().nullable().optional(), explanation: z.string().nullable().optional() }).nullable().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});

const modelsResponseSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/**
 * Raw-HTTP client for Anthropic's Messages API. Raw HTTP rather than the SDK because Obsidian
 * plugins must send requests through `requestUrl` (HttpPort), not `fetch`.
 *
 * Structured output uses native `output_config.format`; tool calls are never forced (current models
 * reject forced `tool_choice`), the required tool is named in the system prompt instead. Sampling
 * parameters are not sent: current models reject non-default `temperature`.
 */
export class AnthropicClient implements ChatProvider, ModelLister {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;

  constructor(
    private readonly config: EndpointConfig,
    private readonly deps: ClientDeps,
  ) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.id = `anthropic:${this.baseUrl}`;
    this.model = config.model;
    this.capabilities = {
      jsonSchema: config.jsonSchema,
      toolCalling: config.toolCalling,
      embeddings: false,
      maxContext: config.maxContext,
      local: isLoopbackUrl(this.baseUrl),
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const systemParts = request.messages.filter((m) => m.role === 'system').map((m) => m.content);
    if (request.toolChoice && request.toolChoice !== 'auto') {
      systemParts.push(
        typeof request.toolChoice === 'string'
          ? 'Answer by calling one of the provided tools.'
          : `Answer by calling the ${request.toolChoice.name} tool.`,
      );
    }
    const system = systemParts.join('\n\n');

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toWireMessages(request.messages),
    };
    if (system) {
      body.system = system.length > CACHE_SYSTEM_CHARS ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
    }
    if (request.schema) {
      body.output_config = { format: { type: 'json_schema', schema: toAnthropicSchema(request.schema.schema) } };
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
      body.tool_choice = { type: 'auto' };
    }
    const headers: Record<string, string> = {};
    if (FALLBACK_MODELS.has(this.model) && this.baseUrl === 'https://api.anthropic.com') {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = FALLBACK_BETA;
    }

    const json = await this.request('POST', '/v1/messages', body, headers, this.deps.chatTimeoutMs ?? 300_000);
    const parsed = messageResponseSchema.safeParse(json);
    if (!parsed.success) throw new ProviderError('invalid-response', 'The Messages API response did not have the expected shape.');
    const response = parsed.data;
    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category;
      throw new ProviderError('refusal', `The model declined this request${category ? ` (${category})` : ''}.`);
    }

    const text: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text' && 'text' in block && typeof block.text === 'string') text.push(block.text);
      if (block.type === 'tool_use' && 'id' in block && 'name' in block) {
        const input = (block as { input?: unknown }).input ?? {};
        toolCalls.push({ id: String(block.id), name: String(block.name), arguments: input, rawArguments: JSON.stringify(input) });
      }
    }
    return {
      text: text.join(''),
      toolCalls,
      usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
      model: response.model ?? this.model,
      finishReason: response.stop_reason ?? null,
    };
  }

  async listModels(): Promise<string[]> {
    const json = await this.request('GET', '/v1/models?limit=100', undefined, {}, 15_000);
    const parsed = modelsResponseSchema.safeParse(json);
    if (!parsed.success) throw new ProviderError('invalid-response', 'The model list did not have the expected shape.');
    return parsed.data.data.map((model) => model.id).sort();
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>,
    timeoutMs: number,
  ): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': API_VERSION, ...extraHeaders };
    if (this.config.secretName) {
      const key = await this.deps.secrets.get(this.config.secretName);
      if (!key) throw new ProviderError('auth', `The secret "${this.config.secretName}" is empty or missing in Obsidian's keychain.`);
      headers['x-api-key'] = key;
    }
    let response;
    try {
      response = await this.deps.http.request({
        url: `${this.baseUrl}${path}`,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('network', `Could not reach ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status < 200 || response.status >= 300) throw ProviderError.fromStatus(response.status, response.text, response.headers);
    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      throw new ProviderError('invalid-response', 'The provider returned something that is not JSON.');
    }
  }
}

/** Messages API turns: system text is sent separately; tool calls and results become content blocks. */
function toWireMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  const wire: Record<string, unknown>[] = [];
  for (const message of messages) {
    switch (message.role) {
      case 'system':
        break;
      case 'user':
        wire.push({ role: 'user', content: message.content });
        break;
      case 'assistant': {
        const blocks: Record<string, unknown>[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} });
        wire.push({ role: 'assistant', content: blocks.length > 0 ? blocks : message.content });
        break;
      }
      case 'tool':
        wire.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }] });
        break;
    }
  }
  return wire;
}

const UNSUPPORTED_KEYWORDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  '$schema',
]);

/**
 * Adapts a JSON schema to what structured outputs accept: no numeric, length or array-size
 * constraints, and `additionalProperties: false` on every object. Removed constraints are still
 * enforced client-side, because every response is validated with the original zod schema.
 */
export function toAnthropicSchema(schema: JsonSchema): JsonSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYWORDS.has(key)) continue;
      result[key] = visit(value);
    }
    if (result.type === 'object') result.additionalProperties = false;
    return result;
  };
  return visit(schema) as JsonSchema;
}
