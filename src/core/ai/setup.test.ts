import { describe, expect, it } from 'vitest';
import { aiSettingsSchema } from './settings';
import { applyAiSetup, CLOUD_PROVIDERS, currentSetup, LOCAL_PROVIDERS, secretNameFor } from './setup';

const defaults = aiSettingsSchema.parse({});

describe('guided AI setup', () => {
  it('offers local and cloud providers separately', () => {
    expect(LOCAL_PROVIDERS.map((p) => p.id)).toEqual(['ollama', 'lm-studio']);
    expect(CLOUD_PROVIDERS.map((p) => p.id)).toContain('anthropic');
    expect(CLOUD_PROVIDERS.map((p) => p.id)).not.toContain('custom');
  });

  it('sets up a local model, with similarity by meaning, and keeps local-only mode on', () => {
    const ai = applyAiSetup(defaults, { mode: 'local', preset: 'ollama', model: 'qwen3:8b', similarity: true });
    expect(ai.chat).toMatchObject({ enabled: true, preset: 'ollama', model: 'qwen3:8b', baseUrl: 'http://localhost:11434/v1', reasoning: 'none' });
    expect(ai.embeddings).toMatchObject({ enabled: true, model: 'bge-m3' });
    expect(ai.localOnly).toBe(true);
    expect(currentSetup(ai)).toEqual({ mode: 'local', preset: 'ollama', model: 'qwen3:8b', similarity: true });
  });

  it('sets up a cloud model with a key from the keychain and lets requests reach its host', () => {
    const ai = applyAiSetup(defaults, { mode: 'cloud', preset: 'anthropic', model: '', secretName: secretNameFor('anthropic') });
    expect(ai.chat).toMatchObject({ enabled: true, kind: 'anthropic', model: 'claude-opus-5-5', secretName: 'ai-vault-organizer-anthropic' });
    expect(ai.localOnly).toBe(false);
    expect(JSON.stringify(ai)).not.toMatch(/sk-/);
  });

  it('turns everything off for no AI', () => {
    const on = applyAiSetup(defaults, { mode: 'local', preset: 'ollama', model: 'qwen3:8b', similarity: true });
    const off = applyAiSetup(on, { mode: 'none' });
    expect([off.chat.enabled, off.embeddings.enabled]).toEqual([false, false]);
    expect(currentSetup(off)).toEqual({ mode: 'none' });
  });
});
