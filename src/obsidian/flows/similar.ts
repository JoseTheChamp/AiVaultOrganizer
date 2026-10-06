import { Notice, type TFile } from 'obsidian';
import { hostOf } from '../../core/ai/endpoint-url';
import type { SendEstimate, SimilarityResult } from '../../core/embeddings/similarity';
import { plural } from '../../core/model/text';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';
import { SimilarNotesModal } from '../views/similar-notes-modal';
import { charterConstraints } from './review';

const RESULTS = 20;

/**
 * `Find similar notes` for the active note. Indexing (first run, or notes changed since) shows a
 * progress notice that stops when clicked; text is only sent to a cloud embedding provider after
 * the user agrees; whatever goes wrong, word statistics still answer.
 */
export async function findSimilarNotes(plugin: AiVaultOrganizerPlugin, file: TFile): Promise<void> {
  const { ignore } = await charterConstraints(plugin);
  const host = hostOf(plugin.settings.ai.embeddings.baseUrl);
  const progress = { notice: null as Notice | null, stopped: false };
  try {
    const result = await plugin.services.similarity.similar({
      path: file.path,
      k: RESULTS,
      provider: plugin.services.ai.embeddings(),
      ignore,
      exclude: [plugin.settings.charterPath],
      isCancelled: () => progress.stopped,
      onProgress: ({ done, total, method }) => {
        if (!progress.notice) {
          progress.notice = new Notice('', 0);
          // Clicking a notice dismisses it; for this one it also stops indexing.
          progress.notice.containerEl.addEventListener('click', () => (progress.stopped = true));
        }
        const what = method === 'embeddings' ? 'Indexing notes by meaning' : 'Reading notes';
        progress.notice.setMessage(`${what}: ${done} of ${total}. Click to stop.`);
      },
      confirmSend: (estimate) => confirmSend(plugin, host, estimate),
    });
    explainFallback(result, host);
    new SimilarNotesModal(plugin.app, file, result).open();
  } catch (error) {
    plugin.services.logger.error('Finding similar notes failed', error);
    new Notice('Finding similar notes failed. Enable debug logging and check the developer console for details.');
  } finally {
    progress.notice?.hide();
  }
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

function explainFallback(result: SimilarityResult, host: string): void {
  const instead = 'Showing notes that share words instead.';
  switch (result.fallback) {
    case undefined:
    case 'declined':
      return;
    case 'private':
      new Notice(`This note is private, so it is never sent to ${host}. ${instead}`);
      return;
    case 'cancelled':
      new Notice(`Indexing stopped; the next search continues where it left off. ${instead}`);
      return;
    case 'not-indexed':
      new Notice(`This note is not in the similarity index yet. ${instead}`);
      return;
    case 'error':
      new Notice(`The embedding model is unavailable: ${result.error ?? 'unknown error'} ${instead}`, 10_000);
      return;
  }
}
