import { describe, expect, it } from 'vitest';
import { FakeHttp, FakeSecrets } from '../testing/fake-http';
import { endpointConfigSchema } from './config';
import { isLoopbackUrl } from './endpoint-url';
import { OpenAICompatibleClient, stripThinking } from './openai-compatible';
import { ProviderError } from './types';

const local = endpointConfigSchema.parse({ model: 'qwen3:8b' });
const cloud = endpointConfigSchema.parse({ preset: 'openai', baseUrl: 'https://api.openai.com/v1/', model: 'gpt', secretName: 'openai' });

const completion = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  model: 'qwen3:8b',
  choices: [{ message, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 3 },
  ...extra,
});

describe('OpenAICompatibleClient.chat', () => {
  it('sends messages and a JSON schema, and parses the answer', async () => {
    const http = new FakeHttp().json('POST', /\/chat\/completions$/, completion({ content: '<think>hmm</think>\n{"ok":true}' }));
    const client = new OpenAICompatibleClient(local, { http, secrets: new FakeSecrets() });
    const response = await client.chat({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Status?' },
      ],
      temperature: 0,
      maxTokens: 50,
      schema: { name: 'status reply', schema: { type: 'object' }, strict: true },
    });

    expect(response).toEqual({ text: '{"ok":true}', toolCalls: [], usage: { inputTokens: 12, outputTokens: 3 }, model: 'qwen3:8b', finishReason: 'stop' });
    expect(http.requests[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(http.requests[0]?.headers?.Authorization).toBeUndefined();
    expect(http.body()).toMatchObject({
      model: 'qwen3:8b',
      temperature: 0,
      max_tokens: 50,
      stream: false,
      response_format: { type: 'json_schema', json_schema: { name: 'status_reply', schema: { type: 'object' }, strict: true } },
    });
    expect(client.capabilities.local).toBe(true);
  });

  it('uses JSON mode and maps tools and tool results both ways', async () => {
    const http = new FakeHttp().json(
      'POST',
      /chat/,
      completion({ content: null, tool_calls: [{ id: 'c1', function: { name: 'list_presets', arguments: { lang: 'cs' } } }] }),
    );
    const client = new OpenAICompatibleClient(local, { http, secrets: new FakeSecrets() });
    const response = await client.chat({
      messages: [
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'get_overview', arguments: {}, rawArguments: '{}' }] },
        { role: 'tool', toolCallId: 'c0', name: 'get_overview', content: '{"notes":3}' },
      ],
      jsonMode: true,
      tools: [{ name: 'list_presets', description: 'List presets', parameters: { type: 'object' } }],
      toolChoice: { name: 'list_presets' },
    });
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'list_presets', arguments: { lang: 'cs' }, rawArguments: '{"lang":"cs"}' }]);
    expect(http.body()).toMatchObject({
      response_format: { type: 'json_object' },
      tool_choice: { type: 'function', function: { name: 'list_presets' } },
      messages: [
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c0', type: 'function', function: { name: 'get_overview', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'c0', name: 'get_overview', content: '{"notes":3}' },
      ],
    });
  });

  it('sends a reasoning level only when one is chosen', async () => {
    const http = new FakeHttp().json('POST', /\/chat\/completions$/, completion({ content: 'OK' }));
    await new OpenAICompatibleClient({ ...local, reasoning: 'none' }, { http, secrets: new FakeSecrets() }).chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(http.body()).toMatchObject({ reasoning_effort: 'none' });
    await new OpenAICompatibleClient(local, { http, secrets: new FakeSecrets() }).chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(http.body(1)).not.toHaveProperty('reasoning_effort');
  });

  it('explains an answer that ran out of output tokens while reasoning', async () => {
    const http = new FakeHttp().json('POST', /\/chat\/completions$/, {
      ...completion({ content: '', reasoning: 'Okay, the user wants…' }),
      choices: [{ message: { content: '', reasoning: 'Okay, the user wants…' }, finish_reason: 'length' }],
    });
    const client = new OpenAICompatibleClient(local, { http, secrets: new FakeSecrets() });
    await expect(client.chat({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 20 })).rejects.toMatchObject({
      kind: 'invalid-response',
      message: expect.stringContaining('Turn thinking off') as string,
    });
  });

  it('sends the key from secret storage only to configured endpoints', async () => {
    const http = new FakeHttp().json('POST', /chat/, completion({ content: 'hi' }));
    const client = new OpenAICompatibleClient(cloud, { http, secrets: new FakeSecrets({ openai: 'sk-test' }) });
    await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(http.requests[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(http.requests[0]?.headers?.Authorization).toBe('Bearer sk-test');
    expect(client.capabilities.local).toBe(false);

    const missing = new OpenAICompatibleClient(cloud, { http, secrets: new FakeSecrets() });
    await expect(missing.chat({ messages: [] })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('turns failures into typed provider errors', async () => {
    const statuses = new FakeHttp().json('POST', /chat/, { error: 'slow down' }, 429, { 'retry-after': '2' });
    await expect(new OpenAICompatibleClient(local, { http: statuses, secrets: new FakeSecrets() }).chat({ messages: [] })).rejects.toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 2000,
    });
    const down = new FakeHttp().on('POST', /chat/, () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(new OpenAICompatibleClient(local, { http: down, secrets: new FakeSecrets() }).chat({ messages: [] })).rejects.toBeInstanceOf(ProviderError);
    const garbage = new FakeHttp().on('POST', /chat/, () => ({ status: 200, headers: {}, text: '<html>' }));
    await expect(new OpenAICompatibleClient(local, { http: garbage, secrets: new FakeSecrets() }).chat({ messages: [] })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
});

describe('OpenAICompatibleClient embeddings and models', () => {
  it('returns one vector per input in input order', async () => {
    const http = new FakeHttp().json('POST', /\/embeddings$/, {
      data: [
        { embedding: [0, 1], index: 1 },
        { embedding: [1, 0], index: 0 },
      ],
      usage: { prompt_tokens: 4 },
    });
    const client = new OpenAICompatibleClient({ ...local, model: 'bge-m3' }, { http, secrets: new FakeSecrets() });
    const result = await client.embed(['a', 'b']);
    expect(result.vectors.map((v) => [...v])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(http.body()).toEqual({ model: 'bge-m3', input: ['a', 'b'] });
    expect((await client.embed([])).vectors).toEqual([]);
  });

  it('rejects a vector count that does not match the inputs', async () => {
    const http = new FakeHttp().json('POST', /embeddings/, { data: [{ embedding: [1] }] });
    await expect(new OpenAICompatibleClient(local, { http, secrets: new FakeSecrets() }).embed(['a', 'b'])).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('lists models sorted', async () => {
    const http = new FakeHttp().json('GET', /\/models$/, { data: [{ id: 'qwen3:8b' }, { id: 'bge-m3' }] });
    expect(await new OpenAICompatibleClient(local, { http, secrets: new FakeSecrets() }).listModels()).toEqual(['bge-m3', 'qwen3:8b']);
  });
});

describe('helpers', () => {
  it('recognizes loopback URLs', () => {
    expect(isLoopbackUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:1234')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8080')).toBe(true);
    expect(isLoopbackUrl('http://ollama.localhost')).toBe(true);
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackUrl('http://localhost.evil.com')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });

  it('strips a leading think block only', () => {
    expect(stripThinking('<think>\nplan\n</think>\n\nAnswer')).toBe('Answer');
    expect(stripThinking('Answer <think>x</think>')).toBe('Answer <think>x</think>');
  });
});
