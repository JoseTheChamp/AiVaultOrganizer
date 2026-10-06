import { Notice, type TFile } from 'obsidian';
import { hostOf } from '../../core/ai/endpoint-url';
import type AiVaultOrganizerPlugin from '../main';
import { SimilarNotesModal } from '../views/similar-notes-modal';
import { fallbackMessage, indexingProgress } from './indexing';
import { charterConstraints } from './review';

const RESULTS = 20;

/**
 * `Find similar notes` for the active note: indexes what changed (see `indexingProgress`) and,
 * whatever goes wrong, still answers from word statistics.
 */
export async function findSimilarNotes(plugin: AiVaultOrganizerPlugin, file: TFile): Promise<void> {
  const { ignore } = await charterConstraints(plugin);
  const progress = indexingProgress(plugin);
  try {
    const result = await plugin.services.similarity.similar({
      path: file.path,
      k: RESULTS,
      provider: plugin.services.ai.embeddings(),
      ignore,
      exclude: [plugin.settings.charterPath],
      ...progress.options,
    });
    const message = fallbackMessage(result, hostOf(plugin.settings.ai.embeddings.baseUrl), 'Showing notes that share words instead.');
    if (message) new Notice(message, result.fallback === 'error' ? 10_000 : undefined);
    new SimilarNotesModal(plugin.app, file, result).open();
  } catch (error) {
    plugin.services.logger.error('Finding similar notes failed', error);
    new Notice('Finding similar notes failed. Enable debug logging and check the developer console for details.');
  } finally {
    progress.hide();
  }
}
