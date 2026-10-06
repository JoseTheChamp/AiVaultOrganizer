import { describe, expect, it } from 'vitest';
import { createSearchHandler, type DenseIndex, type SearchRequest, type SearchResponse } from '../../core/embeddings/search';
import { silentLogger } from '../../core/ports';
import { SearchClient, type WorkerLike } from './search-client';

/** Answers asynchronously from a real handler, like a worker would; can be made to crash. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: SearchResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  received: SearchRequest[] = [];
  /** When true, the next message makes the worker fail instead of answering. */
  crashNext = false;
  private readonly handle = createSearchHandler();

  postMessage(message: SearchRequest): void {
    this.received.push(message);
    const copy = structuredClone(message);
    setTimeout(() => {
      if (this.crashNext) {
        this.onerror?.({ message: 'boom' });
        return;
      }
      this.onmessage?.({ data: this.handle(copy) });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const index: DenseIndex = {
  paths: ['a.md', 'b.md', 'c.md'],
  dims: 2,
  matrix: Float32Array.from([1, 0, 0.8, 0.6, 0, 1]),
};

describe('SearchClient', () => {
  it('searches in the worker', async () => {
    const worker = new FakeWorker();
    const client = new SearchClient(() => worker, silentLogger);
    expect(client.inWorker).toBe(true);
    expect(await client.load(index)).toBe(3);
    const [first, second] = await Promise.all([client.similar('a.md', 1), client.similar('c.md', 1)]);
    expect(first?.[0]?.path).toBe('b.md');
    expect(second?.[0]?.path).toBe('b.md');
    expect(worker.received.map((message) => message.type)).toEqual(['load', 'similar', 'similar']);
  });

  it('falls back to the main thread when the worker cannot start', async () => {
    const client = new SearchClient(() => {
      throw new Error('workers blocked');
    }, silentLogger);
    expect(client.inWorker).toBe(false);
    await client.load(index);
    expect((await client.similar('a.md', 1))[0]?.path).toBe('b.md');
  });

  it('answers in-flight searches locally when the worker fails', async () => {
    const worker = new FakeWorker();
    const client = new SearchClient(() => worker, silentLogger);
    await client.load(index);
    worker.crashNext = true;
    expect((await client.similar('a.md', 1))[0]?.path).toBe('b.md');
    expect(worker.terminated).toBe(true);
    expect(client.inWorker).toBe(false);
    expect((await client.similar('c.md', 1))[0]?.path).toBe('b.md');
  });

  it('terminates the worker and rejects pending searches on dispose', async () => {
    const worker = new FakeWorker();
    const client = new SearchClient(() => worker, silentLogger);
    await client.load(index);
    const pending = client.similar('a.md', 1);
    client.dispose();
    await expect(pending).rejects.toThrow(/stopped/);
    expect(worker.terminated).toBe(true);
  });
});
