import { describe, expect, it } from 'vitest';
import { configFromPreset, ENDPOINT_PRESETS, endpointConfigSchema, findPreset, trimBaseUrl } from './config';
import { ProviderError } from './types';

describe('ProviderError.fromStatus', () => {
  it('classifies statuses and honors Retry-After', () => {
    expect(ProviderError.fromStatus(401, 'bad key')).toMatchObject({ kind: 'auth', retryable: false });
    const limited = ProviderError.fromStatus(429, '', { 'Retry-After': '7' });
    expect(limited).toMatchObject({ kind: 'rate-limit', retryAfterMs: 7000, retryable: true });
    expect(ProviderError.fromStatus(503, 'down')).toMatchObject({ kind: 'server', retryable: true });
    expect(ProviderError.fromStatus(400, 'no')).toMatchObject({ kind: 'bad-request', retryable: false });
  });

  it('keeps error messages short and single-line', () => {
    const error = ProviderError.fromStatus(500, `line one\n${'x'.repeat(1000)}`);
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).not.toContain('\n');
  });
});

describe('endpoint config', () => {
  it('defaults to a keyless local Ollama endpoint', () => {
    expect(endpointConfigSchema.parse({})).toMatchObject({ kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', secretName: '' });
  });

  it('builds configs from presets and never stores a secret for keyless endpoints', () => {
    const ollama = findPreset('ollama');
    const openai = findPreset('openai');
    if (!ollama || !openai) throw new Error('presets missing');
    expect(configFromPreset(ollama, 'embeddings', 'my-key')).toMatchObject({ model: 'bge-m3', secretName: '' });
    expect(configFromPreset(openai, 'chat', 'openai-key')).toMatchObject({ model: 'gpt-4.1-mini', secretName: 'openai-key' });
    expect(new Set(ENDPOINT_PRESETS.map((p) => p.id)).size).toBe(ENDPOINT_PRESETS.length);
  });

  it('trims trailing slashes', () => {
    expect(trimBaseUrl(' http://localhost:11434/v1// ')).toBe('http://localhost:11434/v1');
  });
});
