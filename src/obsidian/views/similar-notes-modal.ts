import { type App, SuggestModal, type TFile } from 'obsidian';
import type { SimilarityResult } from '../../core/embeddings/similarity';
import type { Neighbor } from '../../core/embeddings/top-k';
import { parentFolder } from '../../core/model/paths';

interface SimilarItem extends Neighbor {
  title: string;
  folder: string;
}

/**
 * The notes most similar to the active note, best first. Typing filters the list; Enter opens a
 * note, Mod+Enter opens it in a new tab. The placeholder says which method found them.
 */
export class SimilarNotesModal extends SuggestModal<SimilarItem> {
  private readonly items: SimilarItem[];

  constructor(app: App, source: TFile, result: SimilarityResult) {
    super(app);
    this.items = result.neighbors.map((neighbor) => ({
      ...neighbor,
      title: neighbor.path.slice(neighbor.path.lastIndexOf('/') + 1).replace(/\.md$/i, ''),
      folder: parentFolder(neighbor.path),
    }));
    this.setPlaceholder(
      result.method === 'embeddings' ? `Notes similar in meaning to "${source.basename}"` : `Notes sharing words with "${source.basename}"`,
    );
    this.emptyStateText = 'No similar notes found.';
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: 'mod ↵', purpose: 'to open in a new tab' },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
    this.scope.register(['Mod'], 'Enter', (event) => {
      this.selectActiveSuggestion(event);
      return false;
    });
  }

  override getSuggestions(query: string): SimilarItem[] {
    const needle = query.trim().toLowerCase();
    return needle ? this.items.filter((item) => item.path.toLowerCase().includes(needle)) : this.items;
  }

  override renderSuggestion(item: SimilarItem, el: HTMLElement): void {
    el.addClass('avo-similar-item');
    const text = el.createDiv({ cls: 'avo-similar-text' });
    text.createDiv({ text: item.title });
    if (item.folder) text.createDiv({ cls: 'avo-muted', text: item.folder });
    el.createDiv({ cls: 'avo-similar-score', text: `${Math.round(item.score * 100)}%` });
  }

  override onChooseSuggestion(item: SimilarItem, event: MouseEvent | KeyboardEvent): void {
    void this.app.workspace.openLinkText(item.path, '', event.ctrlKey || event.metaKey);
  }
}
