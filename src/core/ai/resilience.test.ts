import { describe, expect, it } from 'vitest';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { ConcurrencyPool, defaultConcurrency, ResilientChatProvider, TokenBucket, withRetry } from './resilience';
import { ProviderError } from './types';

function fakeTime() {
  let now = 0;
  const slept: number[] = [];
  return {
    clock: { now: () => now },
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    slept,
  };
}

describe('withRetry', () => {
  it('retries retryable errors with exponential backoff and jitter', async () => {
    const time = fakeTime();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new ProviderError('server', 'boom', 503);
        return 'ok';
      },
      { retries: 3, baseDelayMs: 1000, maxDelayMs: 10_000, sleep: time.sleep, random: () => 1 },
    );
    expect(result).toBe('ok');
    expect(time.slept).toEqual([1000, 2000]);
  });

  it('honors Retry-After and caps delays', async () => {
    const time = fakeTime();
    const errors = [new ProviderError('rate-limit', 'slow', 429, 7000), new ProviderError('rate-limit', 'slower', 429, 60_000)];
    await withRetry(
      async () => {
        const next = errors.shift();
        if (next) throw next;
        return true;
      },
      { retries: 5, baseDelayMs: 100, maxDelayMs: 30_000, sleep: time.sleep },
    );
    expect(time.slept).toEqual([7000, 30_000]);
  });

  it('does not retry permanent errors and stops after the last retry', async () => {
    const time = fakeTime();
    await expect(withRetry(async () => Promise.reject(new ProviderError('auth', 'no')), { retries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: time.sleep })).rejects.toMatchObject({
      kind: 'auth',
    });
    await expect(
      withRetry(async () => Promise.reject(new ProviderError('timeout', 't')), { retries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: time.sleep }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(time.slept).toHaveLength(2);
  });
});

describe('ConcurrencyPool', () => {
  it('never runs more than the limit at once and keeps arrival order', async () => {
    const pool = new ConcurrencyPool(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const release: (() => void)[] = [];
    const tasks = [1, 2, 3, 4].map((n) =>
      pool.run(async () => {
        running++;
        peak = Math.max(peak, running);
        order.push(n);
        await new Promise<void>((resolve) => release.push(resolve));
        running--;
        return n;
      }),
    );
    await Promise.resolve();
    while (release.length > 0 || order.length < 4) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      release.shift()?.();
    }
    expect(await Promise.all(tasks)).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(() => new ConcurrencyPool(0)).toThrow();
  });

  it('frees its slot when a task fails', async () => {
    const pool = new ConcurrencyPool(1);
    await expect(pool.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await pool.run(async () => 'next')).toBe('next');
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then waits for refills', async () => {
    const time = fakeTime();
    const bucket = new TokenBucket({ capacity: 2, perMinute: 60, clock: time.clock, sleep: time.sleep });
    await bucket.take();
    await bucket.take();
    expect(time.slept).toEqual([]);
    await bucket.take();
    expect(time.slept).toEqual([1000]);
  });
});

describe('ResilientChatProvider', () => {
  it('retries transient failures of the wrapped provider', async () => {
    const time = fakeTime();
    const inner = new ScriptedChatProvider([new ProviderError('network', 'down'), 'hello']);
    const provider = new ResilientChatProvider(inner, {
      pool: new ConcurrencyPool(defaultConcurrency(true)),
      retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 100, sleep: time.sleep, random: () => 0 },
    });
    expect((await provider.chat({ messages: [] })).text).toBe('hello');
    expect(provider.model).toBe('scripted-model');
    expect(time.slept).toEqual([5]);
    expect(defaultConcurrency(false)).toBe(4);
  });
});
