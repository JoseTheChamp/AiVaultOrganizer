import * as z from 'zod';
import type { HttpPort, SecretsPort } from '../ports';
import { type EndpointConfig, trimBaseUrl } from './config';
import { isLoopbackUrl } from './endpoint-url';
import {
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  type EmbeddingProvider,
  type EmbeddingResponse,
  type ModelLister,
  type ProviderCapabilities,
  ProviderError,
  type ToolCall,
} from './types';

export interface ClientDeps {
  http: HttpPort;
  secrets: SecretsPort;
  /** Chat timeout; local models on modest hardware can take minutes for long outputs. */
  chatTimeoutMs?: number;
}

const toolCallSchema = z.object({
  id: z.string().optional(),
  function: z.object({ name: z.string(), arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() }),
});

const chatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(toolCallSchema).nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullable().optional(),
});

const embeddingResponseSchema = z.object({
  model: z.string().optional(),
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().optional() })),
  usage: z.object({ prompt_tokens: z.number().optional() }).nullable().optional(),
});

const modelsResponseSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/**
 * Client for the OpenAI-compatible HTTP API, which Ollama, LM Studio, OpenAI, OpenRouter, Gemini,
 * Mistral and Groq all speak. One instance per endpoint and model (chat or embeddings).
 */
export class OpenAICompatibleClient implements ChatProvider, EmbeddingProvider, ModelLister {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;

  constructor(
    private readonly config: EndpointConfig,
    private readonly deps: ClientDeps,
  ) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.id = `openai-compatible:${this.baseUrl}`;
    this.model = config.model;
    this.capabilities = {
      jsonSchema: config.jsonSchema,
      toolCalling: config.toolCalling,
      embeddings: true,
      maxContext: config.maxContext,
      local: isLoopbackUrl(this.baseUrl),
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map(toWireMessage),
      stream: false,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    // Only sent when chosen: OpenAI rejects the parameter for models that do not reason.
    if (this.config.reasoning !== 'default') body.reasoning_effort = this.config.reasoning;
    if (request.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.schema.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
          schema: request.schema.schema,
          strict: request.schema.strict ?? false,
          ...(request.schema.description ? { description: request.schema.description } : {}),
        },
      };
    } else if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
      if (request.toolChoice) {
        body.tool_choice = typeof request.toolChoice === 'string' ? request.toolChoice : { type: 'function', function: { name: request.toolChoice.name } };
      }
    }

    const json = await this.post('/chat/completions', body, this.deps.chatTimeoutMs ?? 180_000);
    const parsed = chatResponseSchema.safeParse(json);
    if (!parsed.success) throw new ProviderError('invalid-response', 'The chat response did not have the expected shape.');
    const choice = parsed.data.choices[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((call, index) => toToolCall(call, index));
    const text = stripThinking(choice?.message.content ?? '');
    if (text.trim() === '' && toolCalls.length === 0 && choice?.finish_reason === 'length') {
      // Typical for thinking models: the whole output limit went into reasoning, none into the answer.
      throw new ProviderError(
        'invalid-response',
        `${this.model} used its whole output limit before answering, probably on reasoning. Turn thinking off for this model in the settings, or allow longer answers.`,
      );
    }
    return {
      text,
      toolCalls,
      usage: { inputTokens: parsed.data.usage?.prompt_tokens ?? 0, outputTokens: parsed.data.usage?.completion_tokens ?? 0 },
      model: parsed.data.model ?? this.model,
      finishReason: choice?.finish_reason ?? null,
    };
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    if (texts.length === 0) return { vectors: [], usage: { inputTokens: 0, outputTokens: 0 }, model: this.model };
    const json = await this.post('/embeddings', { model: this.model, input: texts }, 120_000);
    const parsed = embeddingResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.data.length !== texts.length) {
      throw new ProviderError('invalid-response', 'The embedding response did not contain one vector per input.');
    }
    const ordered = [...parsed.data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return {
      vectors: ordered.map((item) => Float32Array.from(item.embedding)),
      usage: { inputTokens: parsed.data.usage?.prompt_tokens ?? 0, outputTokens: 0 },
      model: parsed.data.model ?? this.model,
    };
  }

  async listModels(): Promise<string[]> {
    const json = await this.request('GET', '/models', undefined, 15_000);
    const parsed = modelsResponseSchema.safeParse(json);
    if (!parsed.success) throw new ProviderError('invalid-response', 'The model list did not have the expected shape.');
    return parsed.data.data.map((model) => model.id).sort();
  }

  private post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    return this.request('POST', path, body, timeoutMs);
  }

  private async request(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.secretName) {
      const key = await this.deps.secrets.get(this.config.secretName);
      if (!key) throw new ProviderError('auth', `The secret "${this.config.secretName}" is empty or missing in Obsidian's keychain.`);
      headers.Authorization = `Bearer ${key}`;
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

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, name: message.name, content: message.content };
    case 'assistant':
      return message.toolCalls && message.toolCalls.length > 0
        ? {
            role: 'assistant',
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.rawArguments } })),
          }
        : { role: 'assistant', content: message.content };
    case 'system':
    case 'user':
      return { role: message.role, content: message.content };
  }
}

function toToolCall(call: z.infer<typeof toolCallSchema>, index: number): ToolCall {
  const raw = call.function.arguments;
  // Ollama may send arguments as an object instead of a JSON string.
  const rawArguments = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawArguments || '{}');
  } catch {
    parsed = null;
  }
  return { id: call.id ?? `call_${index}`, name: call.function.name, arguments: parsed, rawArguments };
}

/** Reasoning models (Qwen 3, DeepSeek R1) may prefix answers with a <think> block. */
export function stripThinking(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}
