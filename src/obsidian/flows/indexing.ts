import { Notice } from 'obsidian';
import { hostOf } from '../../core/ai/endpoint-url';
import type { NeighborSourceQuery, SendEstimate, SimilarityFallback, SimilarityMethod } from '../../core/embeddings/similarity';
import { plural } from '../../core/model/text';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';

/** A long task in progress: a notice that stops it when clicked, and the dashboard's progress card. */
export interface ActivityHandle {
  /** Options for a similarity query: indexing progress, stopping, and consent before sending. */
  options: Pick<NeighborSourceQuery, 'onProgress' | 'isCancelled' | 'confirmSend'>;
  /** Set when the user stops the task; model stages check it between requests. */
  signal: { readonly aborted: boolean };
  /** Shows what is happening now, with progress when it can be counted. */
  update(detail: string, done?: number, total?: number): void;
  /** Takes the notice and the card away while a dialog asks something; the next update brings them back. */
  pause(): void;
  end(): void;
}

/**
 * Starts showing a long task (organizing, indexing, a draft): in a notice that stops it when
 * clicked, and on the dashboard with a progress bar and Stop. Text is sent to a cloud embedding
 * provider only after the user agrees.
 */
export function startActivity(plugin: AiVaultOrganizerPlugin, title: string): ActivityHandle {
  const host = hostOf(plugin.settings.ai.embeddings.baseUrl);
  let notice: Notice | null = null;
  let stopped = false;
  let ended = false;
  const stop = () => {
    stopped = true;
    show('Stopping…');
  };
  const show = (detail: string, done?: number, total?: number) => {
    if (ended) return;
    if (!notice) {
      notice = new Notice('', 0);
      // Clicking a notice dismisses it; for this one it also stops the task.
      notice.containerEl.addEventListener('click', () => {
        notice = null;
        stop();
      });
    }
    const count = done !== undefined && total ? ` ${done} of ${total}.` : '';
    notice?.setMessage(`${title}: ${detail}${count}${stopped ? '' : ' Click to stop.'}`);
    plugin.setActivity({ title, detail, ...(done !== undefined && total ? { done, total } : {}), stoppable: !stopped }, stop);
  };
  const pause = () => {
    notice?.hide();
    notice = null;
    plugin.setActivity(null);
  };
  return {
    options: {
      isCancelled: () => stopped,
      onProgress: ({ done, total, method }) => show(method === 'embeddings' ? 'indexing notes by meaning' : 'reading notes', done, total),
      confirmSend: async (estimate) => {
        pause();
        return confirmSend(plugin, host, estimate);
      },
    },
    signal: {
      get aborted() {
        return stopped;
      },
    },
    update: show,
    pause,
    end: () => {
      pause();
      ended = true;
    },
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
