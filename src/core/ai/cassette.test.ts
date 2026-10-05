import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { FakeHttp, FakeSecrets } from '../testing/fake-http';
import { CassetteHttp, emptyCassette, scrubUrl, SECRET_PATTERNS } from './cassette';
import { endpointConfigSchema } from './config';
import { OpenAICompatibleClient } from './openai-compatible';

const config = endpointConfigSchema.parse({ baseUrl: 'https://api.example.com/v1', model: 'm', secretName: 'k' });
const secrets = new FakeSecrets({ k: 'sk-live-secret-value-123' });

describe('CassetteHttp', () => {
  it('records live traffic without secrets and replays it offline', async () => {
    const live = new FakeHttp().json('POST', /chat/, { choices: [{ message: { content: 'OK' } }] }, 200, { 'set-cookie': 'session=1', 'retry-after': '1' });
    const cassette = emptyCassette('example');
    const recorder = new CassetteHttp(cassette, 'record', webCryptoHasher, live);
    await new OpenAICompatibleClient(config, { http: recorder, secrets }).chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(recorder.dirty).toBe(true);
    const serialized = JSON.stringify(cassette);
    expect(serialized).not.toContain('sk-live-secret');
    expect(SECRET_PATTERNS.some((pattern) => pattern.test(serialized))).toBe(false);
    expect(cassette.interactions[0]?.response.headers).toEqual({ 'content-type': 'application/json', 'retry-after': '1' });

    const replay = new CassetteHttp(structuredClone(cassette), 'replay', webCryptoHasher);
    const response = await new OpenAICompatibleClient(config, { http: replay, secrets }).chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.text).toBe('OK');
    expect(live.requests).toHaveLength(1);
  });

  it('fails clearly in replay mode for unrecorded requests', async () => {
    const replay = new CassetteHttp(emptyCassette('empty'), 'replay', webCryptoHasher);
    await expect(replay.request({ method: 'GET', url: 'http://localhost:11434/v1/models' })).rejects.toThrow('Cassette "empty" has no response for GET');
  });

  it('matches requests regardless of key order in the JSON body', async () => {
    const live = new FakeHttp().json('POST', /x/, { ok: 1 });
    const cassette = emptyCassette('order');
    await new CassetteHttp(cassette, 'record', webCryptoHasher, live).request({ method: 'POST', url: 'http://h/x', body: '{"a":1,"b":2}' });
    const replay = new CassetteHttp(cassette, 'replay', webCryptoHasher);
    expect((await replay.request({ method: 'POST', url: 'http://h/x', body: '{"b":2,"a":1}' })).status).toBe(200);
  });
});

describe('scrubUrl', () => {
  it('removes credentials and key-like query parameters', () => {
    expect(scrubUrl('https://user:pass@host/v1/models?key=AIzaSecret&alt=json')).toBe('https://host/v1/models?alt=json');
    expect(scrubUrl('not a url')).toBe('not a url');
  });
});
