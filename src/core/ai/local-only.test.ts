import { describe, expect, it } from 'vitest';
import { FakeHttp, FakeSecrets } from '../testing/fake-http';
import { configFromPreset, findPreset } from './config';
import { endpointPolicyProblem, LocalOnlyHttp } from './local-only';
import { OpenAICompatibleClient } from './openai-compatible';

describe('LocalOnlyHttp', () => {
  it('blocks cloud endpoints before sending anything, and allows them when turned off', async () => {
    const inner = new FakeHttp().json('POST', /chat/, { choices: [{ message: { content: 'hi' } }] });
    let localOnly = true;
    const http = new LocalOnlyHttp(inner, () => localOnly);
    const openai = findPreset('openai');
    if (!openai) throw new Error('preset missing');
    const client = new OpenAICompatibleClient(configFromPreset(openai, 'chat', 'key'), { http, secrets: new FakeSecrets({ key: 'sk-x' }) });

    await expect(client.chat({ messages: [] })).rejects.toMatchObject({
      kind: 'blocked',
      message: 'Local-only mode blocks requests to api.openai.com. Turn it off in the settings to use a cloud provider.',
    });
    expect(inner.requests).toHaveLength(0);

    localOnly = false;
    expect((await client.chat({ messages: [] })).text).toBe('hi');
  });

  it('always allows this machine', async () => {
    const inner = new FakeHttp().json('GET', /models/, { data: [] });
    const http = new LocalOnlyHttp(inner, () => true);
    await expect(http.request({ method: 'GET', url: 'http://127.0.0.1:11434/v1/models' })).resolves.toMatchObject({ status: 200 });
  });
});

describe('endpointPolicyProblem', () => {
  it('rejects unsupported schemes and invalid URLs regardless of mode', () => {
    expect(endpointPolicyProblem('file:///etc/passwd', false)).toBe('Only http and https endpoints are supported, not file:.');
    expect(endpointPolicyProblem('localhost:11434', false)).toMatch(/not a valid URL|not file|supported/);
    expect(endpointPolicyProblem('nonsense', false)).toBe('"nonsense" is not a valid URL.');
    expect(endpointPolicyProblem('https://api.anthropic.com', false)).toBeNull();
    expect(endpointPolicyProblem('http://localhost:1234/v1', true)).toBeNull();
  });
});
