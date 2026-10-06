import { type App, Modal } from 'obsidian';
import ConsentDialog from '../../ui/consent/ConsentDialog.svelte';
import { type ConsentChoice, type ConsentInput, consentState } from '../../ui/consent/consent-state';
import { type MountedComponent, mountComponent } from '../../ui/mount';

/**
 * The consent and cost step (PLAN §2.1 step 5, §7.10–7.11): shown before every run that would send
 * notes to a language model, local or not. Closing it counts as cancelling.
 */
class ConsentModal extends Modal {
  private component: MountedComponent | null = null;
  private choice: ConsentChoice = 'cancel';

  constructor(
    app: App,
    private readonly input: ConsentInput,
    private readonly withoutLabel: string,
    private readonly resolve: (choice: ConsentChoice) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle('Use the language model?');
    this.component = mountComponent(ConsentDialog, this.contentEl, {
      state: consentState(this.input),
      withoutLabel: this.withoutLabel,
      answer: (choice: ConsentChoice) => {
        this.choice = choice;
        this.close();
      },
    });
  }

  override onClose(): void {
    this.component?.destroy();
    this.component = null;
    this.contentEl.empty();
    this.resolve(this.choice);
  }
}

/** Asks before a model run; resolves when the dialog closes. */
export function askConsent(app: App, input: ConsentInput, withoutLabel: string): Promise<ConsentChoice> {
  return new Promise((resolve) => new ConsentModal(app, input, withoutLabel, resolve).open());
}
