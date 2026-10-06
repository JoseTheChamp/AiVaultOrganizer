import { estimateTokens } from '../ai/budget';
import { isLoopbackUrl } from '../ai/endpoint-url';
import { type EmbeddingProvider, type EmbeddingResponse, type ProviderCapabilities, ProviderError } from '../ai/types';
import { terms } from '../embeddings/tfidf';

/**
 * A deterministic embedding provider for tests: each text becomes a hashed bag of its terms, so
 * texts that share words get similar vectors. Records every request and can fail on a given call.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly calls: string[][] = [];
  /** 1-based call number that throws a server error, or null. */
  failOnCall: number | null = null;

  constructor(
    readonly model = 'fake-embed',
    readonly dims = 32,
    endpoint = 'http://localhost:11434/v1',
  ) {
    this.id = `fake:${endpoint}`;
    this.capabilities = { jsonSchema: false, toolCalling: false, embeddings: true, maxContext: 8192, local: isLoopbackUrl(endpoint) };
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    this.calls.push([...texts]);
    if (this.failOnCall === this.calls.length) throw new ProviderError('server', 'The embedding server is down.');
    return {
      vectors: texts.map((text) => this.vector(text)),
      usage: { inputTokens: texts.reduce((sum, text) => sum + estimateTokens(text), 0), outputTokens: 0 },
      model: this.model,
    };
  }

  /** Total texts embedded across all calls. */
  get embedded(): number {
    return this.calls.reduce((sum, call) => sum + call.length, 0);
  }

  private vector(text: string): Float32Array {
    const vector = new Float32Array(this.dims);
    for (const term of terms(text)) {
      let hash = 2166136261;
      for (let i = 0; i < term.length; i++) hash = Math.imul(hash ^ term.charCodeAt(i), 16777619);
      vector[(hash >>> 0) % this.dims] = (vector[(hash >>> 0) % this.dims] ?? 0) + 1;
    }
    return vector;
  }
}
