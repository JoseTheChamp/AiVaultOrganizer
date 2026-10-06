import { describe, expect, it } from 'vitest';
import {
  configFromPreset,
  ENDPOINT_PRESETS,
  endpointConfigSchema,
  type EndpointPreset,
  findPreset,
  followsLanguageModel,
  suggestEmbeddingEndpoint,
  trimBaseUrl,
} from './config';

function preset(id: string): EndpointPreset {
  const found = findPreset(id);
  if (!found) throw new Error(`preset ${id} missing`);
  return found;
}

describe('endpoint config', () => {
  it('defaults to a keyless local Ollama endpoint', () => {
    expect(endpointConfigSchema.parse({})).toMatchObject({ kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', secretName: '' });
  });

  it('builds configs from presets and never stores a secret for keyless endpoints', () => {
    expect(configFromPreset(preset('ollama'), 'embeddings', 'my-key')).toMatchObject({ model: 'bge-m3', secretName: '' });
    expect(configFromPreset(preset('openai'), 'chat', 'openai-key')).toMatchObject({ model: 'gpt-4.1-mini', secretName: 'openai-key' });
    expect(new Set(ENDPOINT_PRESETS.map((p) => p.id)).size).toBe(ENDPOINT_PRESETS.length);
  });

  it('trims trailing slashes', () => {
    expect(trimBaseUrl(' http://localhost:11434/v1// ')).toBe('http://localhost:11434/v1');
  });
});

describe('suggestEmbeddingEndpoint', () => {
  it('reuses the language model provider, URL and key when it offers embeddings', () => {
    const chat = { ...configFromPreset(preset('openai'), 'chat', 'openai-key') };
    expect(suggestEmbeddingEndpoint(chat)).toMatchObject({ preset: 'openai', model: 'text-embedding-3-small', secretName: 'openai-key' });
    const remoteOllama = { ...configFromPreset(preset('ollama'), 'chat'), baseUrl: 'http://192.168.1.20:11434/v1' };
    expect(suggestEmbeddingEndpoint(remoteOllama)).toMatchObject({ preset: 'ollama', baseUrl: 'http://192.168.1.20:11434/v1', model: 'bge-m3' });
  });

  it('falls back to local Ollama for providers without embeddings', () => {
    const suggestion = suggestEmbeddingEndpoint(configFromPreset(preset('anthropic'), 'chat', 'anthropic-key'));
    expect(suggestion).toMatchObject({ kind: 'openai-compatible', preset: 'ollama', model: 'bge-m3', secretName: '' });
  });
});

describe('followsLanguageModel', () => {
  it('is true for the suggestion and false once the user picks something else', () => {
    const chat = configFromPreset(preset('openai'), 'chat', 'openai-key');
    const suggested = suggestEmbeddingEndpoint(chat);
    expect(followsLanguageModel(suggested, chat)).toBe(true);
    expect(followsLanguageModel({ ...suggested, baseUrl: `${suggested.baseUrl}/` }, chat)).toBe(true);
    expect(followsLanguageModel({ ...suggested, model: 'text-embedding-3-large' }, chat)).toBe(false);
    expect(followsLanguageModel(configFromPreset(preset('ollama'), 'embeddings'), chat)).toBe(false);
  });

  it('treats the default settings as following, so the first provider choice carries over', () => {
    const defaults = configFromPreset(preset('ollama'), 'embeddings');
    expect(followsLanguageModel(defaults, configFromPreset(preset('ollama'), 'chat'))).toBe(true);
    expect(followsLanguageModel(defaults, configFromPreset(preset('anthropic'), 'chat', 'key'))).toBe(true);
  });
});
