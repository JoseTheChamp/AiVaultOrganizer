import { describe, expect, it } from 'vitest';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { BudgetedChatProvider, estimateCost, estimateRequest, estimateTokens, RunBudget } from './budget';

describe('estimateTokens', () => {
  it('counts about four ASCII characters per token and non-ASCII double', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('žluťoučký')).toBeGreaterThan(estimateTokens('zlutoucky'));
  });
});

describe('estimateRequest', () => {
  it('adds message overhead, schema and tools, and bounds output by maxTokens', () => {
    const plain = estimateRequest({ messages: [{ role: 'user', content: 'x'.repeat(400) }] });
    expect(plain).toEqual({ input: 104, output: 1024 });
    const rich = estimateRequest({
      messages: [{ role: 'user', content: 'x'.repeat(400) }],
      schema: { name: 's', schema: { type: 'object', properties: { a: { type: 'string' } } } },
      tools: [{ name: 't', description: 'd', parameters: {} }],
      maxTokens: 300,
    });
    expect(rich.input).toBeGreaterThan(plain.input);
    expect(rich.output).toBe(300);
  });
});

describe('estimateCost', () => {
  it('uses only configured prices', () => {
    expect(estimateCost({ input: 1_000_000, output: 500_000 }, { inputPerMillion: 2, outputPerMillion: 10 })).toBe(7);
    expect(estimateCost({ input: 1000, output: 1000 }, {})).toBeNull();
  });
});

describe('RunBudget and BudgetedChatProvider', () => {
  it('refuses calls that would exceed the token budget before sending them', async () => {
    const inner = new ScriptedChatProvider(['a', 'b']);
    const provider = new BudgetedChatProvider(inner, new RunBudget({ maxTokens: 1200 }));
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    expect(provider.budget.used).toEqual({ calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    await expect(provider.chat({ messages: [{ role: 'user', content: 'x'.repeat(8000) }], maxTokens: 100 })).rejects.toMatchObject({ kind: 'budget' });
    expect(inner.requests).toHaveLength(1);
  });

  it('limits the number of calls', async () => {
    const provider = new BudgetedChatProvider(new ScriptedChatProvider(['a', 'b']), new RunBudget({ maxTokens: 1e9, maxCalls: 1 }));
    await provider.chat({ messages: [] });
    await expect(provider.chat({ messages: [] })).rejects.toMatchObject({ kind: 'budget', message: "The run's limit of 1 model calls is reached." });
  });

  it('falls back to estimates when a server reports no usage', async () => {
    const inner = new ScriptedChatProvider(['answer text']);
    const silent = { ...inner, id: inner.id, model: inner.model, capabilities: inner.capabilities, chat: async (r: Parameters<typeof inner.chat>[0]) => ({ ...(await inner.chat(r)), usage: { inputTokens: 0, outputTokens: 0 } }) };
    const provider = new BudgetedChatProvider(silent, new RunBudget({ maxTokens: 1e6 }));
    await provider.chat({ messages: [{ role: 'user', content: 'x'.repeat(40) }] });
    expect(provider.budget.used.inputTokens).toBe(14);
    expect(provider.budget.used.outputTokens).toBe(3);
  });
});
