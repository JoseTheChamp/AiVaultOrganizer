/**
 * Entry point of the similarity search worker. Bundled separately by the inline-worker esbuild
 * plugin and started from a Blob URL (see create-search-worker.ts); all logic lives in core.
 */
import { createSearchHandler, type SearchRequest, type SearchResponse } from '../../core/embeddings/search';

interface WorkerScope {
  onmessage: ((event: { data: SearchRequest }) => void) | null;
  postMessage(message: SearchResponse): void;
}

const scope = self as unknown as WorkerScope;
const handle = createSearchHandler();
scope.onmessage = (event) => scope.postMessage(handle(event.data));
