import { createSearchHandler, type DenseIndex, type SearchRequest, type SearchResponse } from '../../core/embeddings/search';
import type { Neighbor } from '../../core/embeddings/top-k';
import type { Logger } from '../../core/ports';

/** The part of `Worker` the client uses; tests substitute an in-process fake. */
export interface WorkerLike {
  postMessage(message: SearchRequest): void;
  onmessage: ((event: { data: SearchResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

interface Pending {
  request: SearchRequest;
  resolve: (response: SearchResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Runs similarity search in a Web Worker so ranking a large vault never blocks the UI (PLAN §6.6).
 * If the worker cannot start or fails later, search continues on the main thread with the same
 * index: the client keeps its own copy (the worker gets a structured clone), so nothing is lost.
 */
export class SearchClient {
  private worker: WorkerLike | null = null;
  private readonly local = createSearchHandler();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    createWorker: () => WorkerLike,
    private readonly logger: Logger,
  ) {
    try {
      const worker = createWorker();
      worker.onmessage = (event) => this.settle(event.data);
      worker.onerror = (event) => this.fail(event.message ?? 'The search worker failed.');
      this.worker = worker;
    } catch (error) {
      this.logger.warn('Search worker unavailable; searching on the main thread.', error);
    }
  }

  /** Whether searches run in a worker (false after a failure or when workers are unavailable). */
  get inWorker(): boolean {
    return this.worker !== null;
  }

  async load(index: DenseIndex): Promise<number> {
    // Mirrored locally so a later worker failure can be answered from the main thread.
    if (this.worker) this.local({ id: 0, type: 'load', paths: [...index.paths], dims: index.dims, matrix: index.matrix });
    const response = await this.request({ id: this.nextId++, type: 'load', paths: [...index.paths], dims: index.dims, matrix: index.matrix });
    if (response.type === 'error') throw new Error(response.message);
    return response.type === 'loaded' ? response.size : 0;
  }

  async similar(path: string, k: number, exclude: readonly string[] = []): Promise<Neighbor[]> {
    const response = await this.request({ id: this.nextId++, type: 'similar', path, k, exclude: [...exclude] });
    if (response.type === 'error') throw new Error(response.message);
    return response.type === 'result' ? response.neighbors : [];
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Search was stopped.'));
    this.pending.clear();
  }

  private request(request: SearchRequest): Promise<SearchResponse> {
    if (!this.worker) return Promise.resolve(this.local(request));
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { request, resolve, reject });
      this.worker?.postMessage(request);
    });
  }

  private settle(response: SearchResponse): void {
    const pending = this.pending.get(response.id);
    this.pending.delete(response.id);
    pending?.resolve(response);
  }

  /** Switches to main-thread search and answers what was in flight from there. */
  private fail(message: string): void {
    this.logger.warn(`Search worker failed (${message}); searching on the main thread.`);
    this.worker?.terminate();
    this.worker = null;
    const inFlight = [...this.pending.values()];
    this.pending.clear();
    // Every load is mirrored locally, so in-flight requests get the same answer from here.
    for (const pending of inFlight) pending.resolve(this.local(pending.request));
  }
}
