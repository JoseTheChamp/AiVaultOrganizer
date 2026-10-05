import * as z from 'zod';
import { stableStringify } from '../model/stable-hash';
import type { Hasher, StoragePort } from '../ports';
import type { ChatProvider, ChatRequest, ChatResponse } from './types';

const PREFIX = 'cache/llm/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const cachedResponseSchema = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string(), arguments: z.unknown(), rawArguments: z.string() })),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  model: z.string(),
  finishReason: z.string().nullable(),
});

/**
 * Content-addressed store of model responses in `.ai-vault-organizer/cache/llm/` (PLAN §7.10): the
 * key hashes provider, model, prompt id and version and the complete request, so re-running a plan
 * or an eval costs nothing, and any change to a prompt or its inputs is a natural miss.
 */
export class ResponseCache {
  constructor(
    private readonly storage: StoragePort,
    private readonly hasher: Hasher,
  ) {}

  async key(providerId: string, model: string, request: ChatRequest): Promise<string> {
    return this.hasher.sha256(
      stableStringify({
        version: 1,
        provider: providerId,
        model,
        prompt: request.prompt ?? null,
        messages: request.messages,
        schema: request.schema ?? null,
        jsonMode: request.jsonMode ?? false,
        tools: request.tools ?? null,
        toolChoice: request.toolChoice ?? null,
        temperature: request.temperature ?? null,
        maxTokens: request.maxTokens ?? null,
      }),
    );
  }

  async get(key: string): Promise<ChatResponse | null> {
    const data = await this.storage.read(this.path(key));
    if (!data) return null;
    try {
      const parsed = cachedResponseSchema.safeParse(JSON.parse(decoder.decode(data)));
      // A damaged entry is a miss; the fresh response overwrites it.
      return parsed.success ? (parsed.data) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, response: ChatResponse): Promise<void> {
    const { cached: _cached, ...stored } = response;
    await this.storage.write(this.path(key), encoder.encode(JSON.stringify(stored)));
  }

  /** Removes every cached response; returns how many there were. */
  async clear(): Promise<number> {
    const keys = await this.storage.list(PREFIX);
    for (const key of keys) await this.storage.remove(key);
    return keys.length;
  }

  private path(key: string): string {
    return `${PREFIX}${key.slice(0, 2)}/${key}.json`;
  }
}

/** Serves repeated requests from the cache; only successful responses are stored. */
export class CachedChatProvider implements ChatProvider {
  constructor(
    private readonly inner: ChatProvider,
    private readonly cache: ResponseCache,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get model(): string {
    return this.inner.model;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const key = await this.cache.key(this.inner.id, this.inner.model, request);
    const hit = await this.cache.get(key);
    if (hit) return { ...hit, cached: true };
    const response = await this.inner.chat(request);
    await this.cache.set(key, response);
    return response;
  }
}
