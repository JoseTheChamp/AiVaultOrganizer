import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { extractJson, generateStructured } from './structured';
import { ProviderError } from './types';

const schema = z.object({ destinationId: z.enum(['projects', 'areas', 'abstain']), confidence: z.number().min(0).max(1) });
const request = { messages: [{ role: 'user' as const, content: 'Classify.' }], schema, schemaName: 'classification', prompt: { id: 'classify-notes', version: 1 } };

describe('generateStructured', () => {
  it('uses native schemas and validates the answer', async () => {
    const provider = new ScriptedChatProvider(['{"destinationId":"projects","confidence":0.9}']);
    const result = await generateStructured(provider, request);
    expect(result.ok && result.value).toMatchObject({ value: { destinationId: 'projects', confidence: 0.9 }, attempts: 1, repaired: false });
    expect(provider.requests[0]?.schema).toMatchObject({ name: 'classification', schema: { type: 'object' } });
    expect(provider.requests[0]?.prompt).toEqual({ id: 'classify-notes', version: 1 });
  });

  it('repairs an invalid answer once with the validation errors', async () => {
    const provider = new ScriptedChatProvider(['{"destinationId":"elsewhere","confidence":2}', '{"destinationId":"abstain","confidence":0.2}']);
    const result = await generateStructured(provider, request);
    expect(result.ok && result.value).toMatchObject({ value: { destinationId: 'abstain' }, attempts: 2, repaired: true });
    const repair = provider.requests[1]?.messages;
    expect(repair?.[1]).toEqual({ role: 'assistant', content: '{"destinationId":"elsewhere","confidence":2}' });
    expect(repair?.[2]?.content).toContain('destinationId: Invalid option');
    expect(repair?.[2]?.content).toContain('confidence: Too big');
  });

  it('gives up after the repair rounds and reports what went wrong', async () => {
    const provider = new ScriptedChatProvider(['nope', 'still nope']);
    const result = await generateStructured(provider, request);
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-output', issues: ['The reply contained no JSON.'], raw: 'still nope', attempts: 2 } });
  });

  it('falls back to JSON mode with the schema in the system prompt', async () => {
    const provider = new ScriptedChatProvider(['```json\n{"destinationId":"areas","confidence":0.5}\n```'], { jsonSchema: false });
    const result = await generateStructured(provider, { ...request, messages: [{ role: 'system', content: 'Rules.' }, ...request.messages] });
    expect(result.ok).toBe(true);
    const sent = provider.requests[0];
    expect(sent?.jsonMode).toBe(true);
    expect(sent?.schema).toBeUndefined();
    expect(sent?.messages[0]?.content).toMatch(/^Rules\.\n\nRespond with a single JSON value/);
  });

  it('returns provider errors and rethrows bugs', async () => {
    const failing = new ScriptedChatProvider([new ProviderError('auth', 'bad key')]);
    const result = await generateStructured(failing, request);
    expect(!result.ok && result.error).toMatchObject({ kind: 'provider', attempts: 1, error: { kind: 'auth' } });
    await expect(generateStructured(new ScriptedChatProvider([new TypeError('bug')]), request)).rejects.toThrow('bug');
  });
});

describe('extractJson', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['Sure! Here it is: {"a":[1,2]} Hope that helps.', { a: [1, 2] }],
    ['```\n[1, 2]\n```', [1, 2]],
  ])('parses %s', (text, expected) => {
    expect(extractJson(text)).toEqual({ ok: true, value: expected });
  });

  it('reports incomplete or missing JSON', () => {
    expect(extractJson('{"a": ')).toEqual({ ok: false, error: 'The reply contained incomplete JSON.' });
    expect(extractJson('{"a": 1')).toEqual({ ok: false, error: 'The reply contained incomplete JSON.' });
    expect(extractJson('no json')).toEqual({ ok: false, error: 'The reply contained no JSON.' });
  });
});
