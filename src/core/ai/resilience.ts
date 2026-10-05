import type { Clock } from '../ports';
import {
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  type EmbeddingProvider,
  type EmbeddingResponse,
  ProviderError,
} from './types';

/** Injected so tests (and Obsidian's popout-safe window timers) control waiting. */
export type Sleep = (ms: number) => Promise<void>;

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: Sleep;
  /** 0..1; injected for deterministic tests. */
  random?: () => number;
  onRetry?: (error: ProviderError, attempt: number, delayMs: number) => void;
}

/**
 * Retries retryable provider errors (network, timeout, 429, 5xx) with exponential backoff and
 * jitter (PLAN §7.10), honoring Retry-After. Other errors propagate immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || attempt >= options.retries) throw error;
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
      const delay = error.retryAfterMs ?? Math.round(backoff * (0.5 + random() / 2));
      options.onRetry?.(error, attempt + 1, delay);
      await options.sleep(Math.min(delay, options.maxDelayMs));
    }
  }
}

/** Runs at most `limit` tasks at once; the rest wait in arrival order. */
export class ConcurrencyPool {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly limit: number) {
    if (limit < 1) throw new Error('Concurrency limit must be at least 1');
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/** Token bucket for requests per minute: bursts up to `capacity`, then a steady refill. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly options: { capacity: number; perMinute: number; clock: Clock; sleep: Sleep },
  ) {
    this.tokens = options.capacity;
    this.updatedAt = options.clock.now();
  }

  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const msPerToken = 60_000 / this.options.perMinute;
      await this.options.sleep(Math.ceil((1 - this.tokens) * msPerToken));
    }
  }

  private refill(): void {
    const now = this.options.clock.now();
    const added = ((now - this.updatedAt) / 60_000) * this.options.perMinute;
    this.tokens = Math.min(this.options.capacity, this.tokens + added);
    this.updatedAt = now;
  }
}

export interface ResilienceOptions {
  pool: ConcurrencyPool;
  retry: RetryOptions;
  bucket?: TokenBucket;
}

/** Default concurrency: local models share one GPU, cloud endpoints parallelize well (§7.10). */
export function defaultConcurrency(local: boolean): number {
  return local ? 2 : 4;
}

/** A chat provider with a concurrency cap, optional rate limit and retries around the real one. */
export class ResilientChatProvider implements ChatProvider {
  constructor(
    private readonly inner: ChatProvider,
    private readonly options: ResilienceOptions,
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

  chat(request: ChatRequest): Promise<ChatResponse> {
    return this.options.pool.run(() =>
      withRetry(async () => {
        await this.options.bucket?.take();
        return this.inner.chat(request);
      }, this.options.retry),
    );
  }
}

export class ResilientEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly options: ResilienceOptions,
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

  embed(texts: string[]): Promise<EmbeddingResponse> {
    return this.options.pool.run(() =>
      withRetry(async () => {
        await this.options.bucket?.take();
        return this.inner.embed(texts);
      }, this.options.retry),
    );
  }
}
