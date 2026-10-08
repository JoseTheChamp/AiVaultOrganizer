import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { FakeHttp, FakeSecrets } from '../testing/fake-http';
import { MemoryStorage } from '../testing/memory-storage';
import { RunBudget } from './budget';
import { configFromPreset, findPreset } from './config';
import { type AiDeps, checkStatus, createChatProvider, createEmbeddingProvider, testConnection } from './factory';
import { type AiSettings, aiSettingsSchema } from './settings';

const completion = { model: 'qwen3:8b', choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } };

function deps(http: FakeHttp, secrets: Record<string, string> = {}): AiDeps {
  let now = 0;
  return { http, secrets: new FakeSecrets(secrets), storage: new MemoryStorage(), hasher: webCryptoHasher, clock: { now: () => (now += 25) }, sleep: async () => undefined };
}

function settings(patch: Partial<AiSettings> = {}): AiSettings {
  const base = aiSettingsSchema.parse({});
  return { ...base, chat: { ...base.chat, enabled: true, model: 'qwen3:8b' }, ...patch };
}

describe('aiSettingsSchema', () => {
  it('starts with AI off, local-only on and a keyless Ollama endpoint', () => {
    const defaults = aiSettingsSchema.parse({});
    expect(defaults).toMatchObject({ localOnly: true, concurrency: 0, budgetTokens: 300_000 });
    expect(defaults.chat).toMatchObject({ enabled: false, baseUrl: 'http://localhost:11434/v1', secretName: '' });
    expect(defaults.embeddings).toMatchObject({ enabled: false, model: 'bge-m3' });
  });

  it('never keeps an API key, only a secret name', () => {
    const parsed = aiSettingsSchema.parse({ chat: { apiKey: 'sk-should-vanish', secretName: 'openai' } });
    expect(JSON.stringify(parsed)).not.toContain('sk-should-vanish');
    expect(parsed.chat.secretName).toBe('openai');
  });
});

describe('createChatProvider', () => {
  it('returns null while the language model is off', () => {
    expect(createChatProvider(aiSettingsSchema.parse({}), deps(new FakeHttp()))).toBeNull();
  });

  it('caches answers and keeps cache hits out of the budget', async () => {
    const http = new FakeHttp().json('POST', /chat/, completion);
    const budget = new RunBudget({ maxTokens: 10_000 });
    const provider = createChatProvider(settings(), deps(http), { budget });
    const request = { messages: [{ role: 'user' as const, content: 'hi' }] };
    await provider?.chat(request);
    const again = await provider?.chat(request);
    expect(again?.cached).toBe(true);
    expect(http.requests).toHaveLength(1);
    expect(budget.used.calls).toBe(1);
  });

  it('applies local-only mode to cloud endpoints', async () => {
    const openai = findPreset('openai');
    if (!openai) throw new Error('preset missing');
    const http = new FakeHttp().json('POST', /chat/, completion);
    const cloud = settings({ chat: { ...configFromPreset(openai, 'chat', 'key'), enabled: true } });
    const provider = createChatProvider(cloud, deps(http, { key: 'sk-x' }));
    await expect(provider?.chat({ messages: [] })).rejects.toMatchObject({ kind: 'blocked' });
    expect(http.requests).toHaveLength(0);
    const allowed = createChatProvider({ ...cloud, localOnly: false }, deps(http, { key: 'sk-x' }));
    await expect(allowed?.chat({ messages: [] })).resolves.toMatchObject({ text: 'OK' });
  });

  it('builds embedding providers only for OpenAI-compatible endpoints', () => {
    const base = settings();
    expect(createEmbeddingProvider(base, deps(new FakeHttp()))).toBeNull();
    expect(createEmbeddingProvider({ ...base, embeddings: { ...base.embeddings, enabled: true } }, deps(new FakeHttp()))?.model).toBe('bge-m3');
  });
});

describe('testConnection', () => {
  it('reports success with latency', async () => {
    const http = new FakeHttp().json('GET', /models/, { data: [{ id: 'qwen3:8b' }] }).json('POST', /chat/, completion);
    expect(await testConnection('chat', settings(), deps(http))).toEqual({ ok: true, message: 'Connected to qwen3:8b (25 ms).', models: ['qwen3:8b'], latencyMs: 25 });
  });

  it('explains a missing model, a blocked host and an unreachable server', async () => {
    const http = new FakeHttp().json('GET', /models/, { data: [{ id: 'llama3.2:3b' }] });
    expect((await testConnection('chat', settings(), deps(http))).message).toBe('Connected, but "qwen3:8b" is not available. Available: llama3.2:3b.');

    const blocked = settings({ chat: { ...settings().chat, baseUrl: 'https://api.openai.com/v1' } });
    expect((await testConnection('chat', blocked, deps(new FakeHttp()))).message).toMatch(/^Local-only mode blocks/);

    const down = new FakeHttp().on('GET', /models/, () => Promise.reject(new Error('ECONNREFUSED')));
    const report = await testConnection('chat', settings(), deps(down));
    expect(report.ok).toBe(false);
    expect(report.message).toContain('Could not reach http://localhost:11434/v1');
  });
});

describe('checkStatus', () => {
  it('is online when the model list answers and has the model, without a chat request', async () => {
    const http = new FakeHttp().json('GET', /models/, { data: [{ id: 'qwen3:8b' }] });
    expect(await checkStatus(settings(), deps(http))).toEqual({ state: 'online', model: 'qwen3:8b', latencyMs: 25 });
    expect(http.requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('names a missing model, an unreachable server, a blocked host, and AI that is off', async () => {
    const missing = new FakeHttp().json('GET', /models/, { data: [{ id: 'llama3.2:3b' }] });
    expect(await checkStatus(settings(), deps(missing))).toEqual({ state: 'missing-model', model: 'qwen3:8b', available: ['llama3.2:3b'] });
    const down = new FakeHttp().on('GET', /models/, () => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(await checkStatus(settings(), deps(down))).toMatchObject({ state: 'offline' });
    const blocked = { ...settings(), chat: { ...settings().chat, baseUrl: 'https://api.openai.com/v1' } };
    expect(await checkStatus(blocked, deps(new FakeHttp()))).toMatchObject({ state: 'blocked' });
    expect(await checkStatus(aiSettingsSchema.parse({}), deps(new FakeHttp()))).toEqual({ state: 'off' });
  });
});
