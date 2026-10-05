import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { MemoryStorage } from '../testing/memory-storage';
import { CachedChatProvider, ResponseCache } from './cache';
import type { ChatRequest } from './types';

const request: ChatRequest = { messages: [{ role: 'user', content: 'Classify A' }], prompt: { id: 'classify-notes', version: 1 }, temperature: 0 };

function setup(replies: string[]) {
  const storage = new MemoryStorage();
  const cache = new ResponseCache(storage, webCryptoHasher);
  const inner = new ScriptedChatProvider(replies);
  return { storage, cache, inner, provider: new CachedChatProvider(inner, cache) };
}

describe('CachedChatProvider', () => {
  it('answers repeated requests from the cache', async () => {
    const { provider, inner, storage } = setup(['first']);
    const live = await provider.chat(request);
    const again = await provider.chat(structuredClone(request));
    expect(live.cached).toBeUndefined();
    expect(again).toMatchObject({ text: 'first', cached: true });
    expect(inner.requests).toHaveLength(1);
    const [key] = await storage.list('cache/llm/');
    expect(key).toMatch(/^cache\/llm\/[0-9a-f]{2}\/[0-9a-f]{64}\.json$/);
    expect(storage.text(key ?? '')).not.toContain('cached');
  });

  it('misses when the prompt version, model inputs or parameters change', async () => {
    const { provider, inner } = setup(['a', 'b', 'c', 'd']);
    await provider.chat(request);
    await provider.chat({ ...request, prompt: { id: 'classify-notes', version: 2 } });
    await provider.chat({ ...request, messages: [{ role: 'user', content: 'Classify B' }] });
    await provider.chat({ ...request, temperature: 0.7 });
    expect(inner.requests).toHaveLength(4);
  });

  it('does not cache failures and treats damaged entries as misses', async () => {
    const { provider, inner, cache, storage } = setup(['ok']);
    const failing = new CachedChatProvider(new ScriptedChatProvider([new Error('down')]), cache);
    await expect(failing.chat(request)).rejects.toThrow('down');
    expect(await storage.list('cache/llm/')).toEqual([]);

    const key = await cache.key(inner.id, inner.model, request);
    await storage.write(`cache/llm/${key.slice(0, 2)}/${key}.json`, new TextEncoder().encode('{broken'));
    expect((await provider.chat(request)).text).toBe('ok');
  });

  it('can be cleared', async () => {
    const { provider, cache, storage } = setup(['a', 'b']);
    await provider.chat(request);
    await provider.chat({ ...request, temperature: 1 });
    expect(await cache.clear()).toBe(2);
    expect(await storage.list('cache/llm/')).toEqual([]);
  });
});
