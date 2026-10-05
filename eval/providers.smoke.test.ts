/**
 * Provider smoke test against a local Ollama, replayed from eval/cassettes/ollama-smoke.json.
 *
 *   npx vitest run eval/providers.smoke.test.ts                 replay (CI, offline)
 *   RECORD=1 npx vitest run eval/providers.smoke.test.ts        re-record against http://localhost:11434
 *   RECORD=1 OLLAMA_MODEL=qwen3:8b npx vitest run eval/...      with another model
 *   RECORD=1 OLLAMA_EMBED_MODEL=bge-m3 npx vitest run eval/...   also record embeddings
 *   (current Ollama only embeds with embedding models, so that case needs one installed)
 *
 * Assertions check shapes, not wording, so any instruction-following model passes.
 */
import * as z from 'zod';
import { afterAll, describe, expect, it } from 'vitest';
import { CassetteHttp } from '../src/core/ai/cassette';
import { configFromPreset, findPreset } from '../src/core/ai/config';
import { OpenAICompatibleClient } from '../src/core/ai/openai-compatible';
import { generateStructured } from '../src/core/ai/structured';
import { webCryptoHasher } from '../src/core/hash';
import { FakeSecrets } from '../src/core/testing/fake-http';
import { loadCassette, saveCassette } from './adapters/cassette-files';
import { FetchHttp } from './adapters/fetch-http';

const record = process.env.RECORD === '1';
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b';
const preset = findPreset('ollama');
if (!preset) throw new Error('ollama preset missing');

const cassette = await loadCassette('ollama-smoke');
const http = new CassetteHttp(cassette, record ? 'record' : 'replay', webCryptoHasher, record ? new FetchHttp() : undefined);
const client = new OpenAICompatibleClient({ ...configFromPreset(preset, 'chat'), model }, { http, secrets: new FakeSecrets() });
const recordedEmbedModel = cassette.interactions
  .filter((interaction) => interaction.request.url.endsWith('/embeddings'))
  .map((interaction) => (interaction.request.body as { model?: string } | null)?.model)
  .find((name): name is string => typeof name === 'string');
const embedModel = record ? process.env.OLLAMA_EMBED_MODEL : recordedEmbedModel;

afterAll(async () => {
  if (record && http.dirty) await saveCassette(cassette);
});

describe.skipIf(!record && cassette.interactions.length === 0)(`Ollama smoke (${model}, ${record ? 'recording' : 'replay'})`, { timeout: 180_000 }, () => {
  it('lists the configured model', async () => {
    expect(await client.listModels()).toContain(model);
  });

  it('chats', async () => {
    const response = await client.chat({ messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }], temperature: 0, maxTokens: 20 });
    expect(response.text.trim().length).toBeGreaterThan(0);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
  });

  it('returns schema-valid structured output', async () => {
    const schema = z.object({
      destinationId: z.enum(['projects', 'areas', 'resources', 'archive', 'abstain']),
      confidence: z.number().min(0).max(1),
    });
    const result = await generateStructured(client, {
      messages: [
        { role: 'system', content: 'You file notes into PARA destinations. Answer with the destination id and your confidence between 0 and 1.' },
        { role: 'user', content: 'Note "Website relaunch": goal is to ship the new company website by December. Tasks: design, hosting, launch.' },
      ],
      schema,
      schemaName: 'classification',
      temperature: 0,
      maxTokens: 100,
    });
    expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
  });

  it.skipIf(!embedModel)('embeds texts into vectors of equal length', async () => {
    const embedder = new OpenAICompatibleClient({ ...configFromPreset(preset, 'embeddings'), model: embedModel ?? '' }, { http, secrets: new FakeSecrets() });
    const { vectors } = await embedder.embed(['Sourdough starter ratio', 'Kvásek na chleba']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.length).toBeGreaterThan(0);
    expect(vectors[0]?.length).toBe(vectors[1]?.length);
  });
});
