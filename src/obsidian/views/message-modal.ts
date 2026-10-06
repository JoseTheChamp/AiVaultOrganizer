import { type App, Modal, Setting } from 'obsidian';

export interface MessageContent {
  title: string;
  paragraphs: string[];
  items?: string[];
  /** Primary action; when absent the modal only has a close button. */
  confirm?: { label: string; warning?: boolean; onConfirm: () => void; onCancel?: () => void };
}

/** Small modal for confirmations and run reports: a title, a few sentences, an optional list. */
export class MessageModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly content: MessageContent,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, content } = this;
    this.setTitle(content.title);
    for (const paragraph of content.paragraphs) contentEl.createEl('p', { text: paragraph });
    if (content.items && content.items.length > 0) {
      const list = contentEl.createEl('ul', { cls: 'avo-issues' });
      for (const item of content.items.slice(0, 50)) list.createEl('li', { text: item });
      if (content.items.length > 50) list.createEl('li', { text: `…and ${content.items.length - 50} more.` });
    }
    const buttons = new Setting(contentEl);
    if (content.confirm) {
      const { label, warning, onConfirm } = content.confirm;
      buttons.addButton((button) => {
        button.setButtonText(label).onClick(() => {
          this.confirmed = true;
          this.close();
          onConfirm();
        });
        // setWarning is deprecated and its replacement needs Obsidian 1.13; the class works everywhere.
        if (warning) button.buttonEl.addClass('mod-warning');
        else button.setCta();
      });
    }
    buttons.addButton((button) => button.setButtonText(content.confirm ? 'Cancel' : 'Close').onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
    // Cancel, Escape and clicking outside all count as declining.
    if (!this.confirmed) this.content.confirm?.onCancel?.();
  }
}
