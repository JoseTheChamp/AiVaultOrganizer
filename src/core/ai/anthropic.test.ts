import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { FakeHttp, FakeSecrets } from '../testing/fake-http';
import { AnthropicClient, toAnthropicSchema } from './anthropic';
import { configFromPreset, endpointConfigSchema, findPreset } from './config';

const preset = findPreset('anthropic');
if (!preset) throw new Error('anthropic preset missing');
const config = configFromPreset(preset, 'chat', 'anthropic-key');
const secrets = new FakeSecrets({ 'anthropic-key': 'sk-ant-test' });

const reply = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5',
  content,
  stop_reason: 'end_turn',
  usage: { input_tokens: 20, output_tokens: 5 },
  ...extra,
});

describe('AnthropicClient.chat', () => {
  it('sends the Messages API request with headers, system and native structured output', async () => {
    const http = new FakeHttp().json('POST', /\/v1\/messages$/, reply([{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }]));
    const client = new AnthropicClient(config, { http, secrets });
    const schema = z.object({ ok: z.boolean(), count: z.number().int().min(1).max(5) });
    const response = await client.chat({
      messages: [
        { role: 'system', content: 'You classify notes.' },
        { role: 'user', content: 'Classify.' },
      ],
      temperature: 0,
      schema: { name: 'result', schema: z.toJSONSchema(schema) },
    });

    expect(response).toEqual({ text: '{"ok":true}', toolCalls: [], usage: { inputTokens: 20, outputTokens: 5 }, model: 'claude-opus-5-5', finishReason: 'end_turn' });
    const request = http.requests[0];
    expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    });
    const body = http.body();
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, system: 'You classify notes.', fallbacks: 'default' });
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages).toEqual([{ role: 'user', content: 'Classify.' }]);
    expect(body.output_config).toEqual({
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, count: { type: 'integer' } },
          required: ['ok', 'count'],
          additionalProperties: false,
        },
      },
    });
  });

  it('never forces tool use, names the tool instead, and maps tool turns to content blocks', async () => {
    const http = new FakeHttp().json(
      'POST',
      /messages/,
      reply([{ type: 'tool_use', id: 'toolu_1', name: 'propose_charter', input: { preset: 'para' } }], { stop_reason: 'tool_use' }),
    );
    const client = new AnthropicClient(config, { http, secrets });
    const response = await client.chat({
      messages: [
        { role: 'user', content: 'Draft a charter.' },
        { role: 'assistant', content: 'Looking.', toolCalls: [{ id: 'toolu_0', name: 'get_overview', arguments: {}, rawArguments: '{}' }] },
        { role: 'tool', toolCallId: 'toolu_0', name: 'get_overview', content: '{"notes":3}' },
      ],
      tools: [{ name: 'propose_charter', description: 'Propose', parameters: { type: 'object' } }],
      toolChoice: { name: 'propose_charter' },
    });
    expect(response.toolCalls).toEqual([{ id: 'toolu_1', name: 'propose_charter', arguments: { preset: 'para' }, rawArguments: '{"preset":"para"}' }]);
    const body = http.body();
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.system).toBe('Answer by calling the propose_charter tool.');
    expect(body.tools).toEqual([{ name: 'propose_charter', description: 'Propose', input_schema: { type: 'object' } }]);
    expect(body.messages).toEqual([
      { role: 'user', content: 'Draft a charter.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'toolu_0', name: 'get_overview', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: '{"notes":3}' }] },
    ]);
  });

  it('caches long system prompts and skips fallbacks for other models and hosts', async () => {
    const http = new FakeHttp().json('POST', /messages/, reply([{ type: 'text', text: 'hi' }]));
    const haiku = new AnthropicClient({ ...config, model: 'claude-haiku-4-5' }, { http, secrets });
    await haiku.chat({ messages: [{ role: 'system', content: 'x'.repeat(5000) }, { role: 'user', content: 'hi' }] });
    expect(http.body().system).toEqual([{ type: 'text', text: 'x'.repeat(5000), cache_control: { type: 'ephemeral' } }]);
    expect(http.body()).not.toHaveProperty('fallbacks');
    expect(http.requests[0]?.headers).not.toHaveProperty('anthropic-beta');

    const proxied = new AnthropicClient(endpointConfigSchema.parse({ kind: 'anthropic', baseUrl: 'http://localhost:4000', model: 'claude-opus-5-5' }), { http, secrets });
    await proxied.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(http.body()).not.toHaveProperty('fallbacks');
    expect(proxied.capabilities).toMatchObject({ local: true, embeddings: false });
  });

  it('reports refusals and HTTP failures as typed errors', async () => {
    const refusing = new FakeHttp().json('POST', /messages/, reply([], { stop_reason: 'refusal', stop_details: { category: 'bio' } }));
    await expect(new AnthropicClient(config, { http: refusing, secrets }).chat({ messages: [] })).rejects.toMatchObject({
      kind: 'refusal',
      message: 'The model declined this request (bio).',
    });
    const overloaded = new FakeHttp().json('POST', /messages/, { type: 'error' }, 529);
    await expect(new AnthropicClient(config, { http: overloaded, secrets }).chat({ messages: [] })).rejects.toMatchObject({ kind: 'server' });
    await expect(new AnthropicClient(config, { http: overloaded, secrets: new FakeSecrets() }).chat({ messages: [] })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('lists models', async () => {
    const http = new FakeHttp().json('GET', /\/v1\/models/, { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }], has_more: false });
    expect(await new AnthropicClient(config, { http, secrets }).listModels()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
  });
});

describe('toAnthropicSchema', () => {
  it('drops unsupported constraints and closes every object', () => {
    expect(
      toAnthropicSchema({
        $schema: 'x',
        type: 'object',
        properties: { list: { type: 'array', minItems: 1, items: { type: 'object', properties: { s: { type: 'string', maxLength: 3 } } } } },
      }),
    ).toEqual({
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'object', properties: { s: { type: 'string' } }, additionalProperties: false } } },
      additionalProperties: false,
    });
  });
});
