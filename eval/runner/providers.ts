import { CassetteHttp } from '../../src/core/ai/cassette';
import { configFromPreset, findPreset } from '../../src/core/ai/config';
import { OpenAICompatibleClient } from '../../src/core/ai/openai-compatible';
import { type ChatProvider, type ChatRequest, type ChatResponse, type EmbeddingProvider, type EmbeddingResponse, ProviderError } from '../../src/core/ai/types';
import { webCryptoHasher } from '../../src/core/hash';
import type { HttpPort } from '../../src/core/ports';
import { FakeSecrets } from '../../src/core/testing/fake-http';
import { loadCassette, saveCassette } from '../adapters/cassette-files';
import { FetchHttp } from '../adapters/fetch-http';

function ollama() {
  const preset = findPreset('ollama');
  if (!preset) throw new Error('ollama preset missing');
  return preset;
}

/** Counts calls and tokens on the way to a provider, for the cost metrics. */
export class Meter {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  /** Requests a replayed cassette had no answer for (tasks treat these as failed calls). */
  missing = 0;
}

class MeteredEmbeddings implements EmbeddingProvider {
  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly meter: Meter,
  ) {}
  get id(): string {
    return this.inner.id;
  }
  get model(): string {
    return this.inner.model;
  }
  get capabilities() {
    return this.inner.capabilities;
  }
  async embed(texts: string[]): Promise<EmbeddingResponse> {
    this.meter.calls++;
    const response = await this.inner.embed(texts);
    this.meter.inputTokens += response.usage.inputTokens;
    return response;
  }
}

class MeteredChat implements ChatProvider {
  constructor(
    private readonly inner: ChatProvider,
    private readonly meter: Meter,
  ) {}
  get id(): string {
    return this.inner.id;
  }
  get model(): string {
    return this.inner.model;
  }
  get capabilities() {
    return this.inner.capabilities;
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.meter.calls++;
    try {
      const response = await this.inner.chat(request);
      this.meter.inputTokens += response.usage.inputTokens;
      this.meter.outputTokens += response.usage.outputTokens;
      return response;
    } catch (error) {
      if (isMissingRecording(error)) this.meter.missing++;
      throw error;
    }
  }
}

/**
 * Ollama embeddings for evals. In replay mode the HTTP port refuses every request, so only vectors
 * already stored for the fixture are used and runs stay offline; recording embeds live.
 */
export function evalEmbeddings(model: string, record: boolean, meter: Meter): EmbeddingProvider {
  const http: HttpPort = record ? new FetchHttp() : { request: () => Promise.reject(new ProviderError('network', 'no stored vectors')) };
  return new MeteredEmbeddings(new OpenAICompatibleClient({ ...configFromPreset(ollama(), 'embeddings'), model }, { http, secrets: new FakeSecrets() }), meter);
}

export interface EvalChat {
  provider: ChatProvider;
  /** Saves new interactions after recording; safe to call after every task. */
  finish(): Promise<void>;
}

/**
 * An Ollama chat model behind a cassette (`eval/cassettes/llm-<fixture>-<model>.json`): replay is
 * offline and deterministic; recording calls the live model and keeps what it answered. Prompts run
 * at temperature 0 and are content-keyed, so a changed prompt or fixture simply misses the cassette.
 */
export async function evalChat(fixture: string, model: string, record: boolean, meter: Meter): Promise<EvalChat> {
  const name = `llm-${fixture}-${model.replace(/[^a-z0-9.-]+/gi, '-')}`;
  const cassette = await loadCassette(name);
  const http = new CassetteHttp(cassette, record ? 'record' : 'replay', webCryptoHasher, record ? new FetchHttp() : undefined);
  const client = new OpenAICompatibleClient({ ...configFromPreset(ollama(), 'chat'), model }, { http, secrets: new FakeSecrets() });
  return {
    provider: new MeteredChat(client, meter),
    finish: async () => {
      if (record && http.dirty) await saveCassette(cassette);
    },
  };
}

/** True for the error a cassette raises when a request was never recorded. */
export function isMissingRecording(error: unknown): boolean {
  return error instanceof Error && /has no response for/.test(error.message);
}
