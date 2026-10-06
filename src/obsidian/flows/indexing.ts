import { Notice } from 'obsidian';
import { hostOf } from '../../core/ai/endpoint-url';
import type { NeighborSourceQuery, SendEstimate, SimilarityFallback, SimilarityMethod } from '../../core/embeddings/similarity';
import { plural } from '../../core/model/text';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';

/** A progress notice for index updates that stops indexing when clicked. */
export interface IndexingProgress {
  /** Index options for a similarity query: progress, stopping, and consent before sending. */
  options: Pick<NeighborSourceQuery, 'onProgress' | 'isCancelled' | 'confirmSend'>;
  /** Shows a message in the same notice (for the steps after indexing). */
  say(message: string): void;
  hide(): void;
}

/**
 * Indexing (the first run, or notes changed since) shows a notice that stops when clicked; text is
 * sent to a cloud embedding provider only after the user agrees.
 */
export function indexingProgress(plugin: AiVaultOrganizerPlugin): IndexingProgress {
  const host = hostOf(plugin.settings.ai.embeddings.baseUrl);
  let notice: Notice | null = null;
  let stopped = false;
  const show = (message: string, stoppable: boolean) => {
    if (!notice) {
      notice = new Notice('', 0);
      // Clicking a notice dismisses it; for this one it also stops indexing.
      notice.containerEl.addEventListener('click', () => (stopped = true));
    }
    notice.setMessage(stoppable ? `${message} Click to stop.` : message);
  };
  return {
    options: {
      isCancelled: () => stopped,
      onProgress: ({ done, total, method }) => show(`${method === 'embeddings' ? 'Indexing notes by meaning' : 'Reading notes'}: ${done} of ${total}.`, true),
      confirmSend: (estimate) => confirmSend(plugin, host, estimate),
    },
    say: (message) => show(message, false),
    hide: () => notice?.hide(),
  };
}

function confirmSend(plugin: AiVaultOrganizerPlugin, host: string, estimate: SendEstimate): Promise<boolean> {
  return new Promise((resolve) => {
    new MessageModal(plugin.app, {
      title: `Send notes to ${host}?`,
      paragraphs: [
        `Better similarity sends the text of ${plural(estimate.notes, 'note')} (about ${estimate.tokens.toLocaleString()} tokens) to ${host} to build its index. Later searches send only notes that changed.`,
        'Notes marked private and notes your charter ignores are never sent. Cancel to compare notes by shared words instead, which stays on this computer.',
      ],
      confirm: { label: 'Send and index', onConfirm: () => resolve(true), onCancel: () => resolve(false) },
    }).open();
  });
}

/** Why word statistics answered although an embedding model is configured, or null when it needs no words. */
export function fallbackMessage(result: { method: SimilarityMethod; fallback?: SimilarityFallback; error?: string }, host: string, instead: string): string | null {
  switch (result.fallback) {
    case undefined:
    case 'declined':
      return null;
    case 'private':
      return `This note is private, so it is never sent to ${host}. ${instead}`;
    case 'cancelled':
      return `Indexing stopped; the next run continues where it left off. ${instead}`;
    case 'not-indexed':
      return `This note is not in the similarity index yet. ${instead}`;
    case 'error':
      return `The embedding model is unavailable: ${result.error ?? 'unknown error'} ${instead}`;
  }
}
