import workerCode from 'inline-worker:./search.worker.ts';
import type { WorkerLike } from './search-client';

/**
 * Starts the search worker from the bundled code via a Blob URL, so the plugin stays a single
 * main.js file. The URL is revoked when the worker is terminated, not right away, because the
 * worker may still be fetching its script.
 */
export function createSearchWorker(): WorkerLike {
  const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: 'ai-vault-organizer-search' });
  const terminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    terminate();
    URL.revokeObjectURL(url);
  };
  return worker as unknown as WorkerLike;
}
