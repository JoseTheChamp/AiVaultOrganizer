import { type App, Modal } from 'obsidian';
import type { Charter } from '../../core/charter/schema';
import { type MountedComponent, mountComponent } from '../../ui/mount';
import SetupWizard from '../../ui/wizard/SetupWizard.svelte';
import type { WizardInput } from '../../ui/wizard/wizard-state';

export interface SetupWizardOptions extends WizardInput {
  onSubmit: (charter: Charter, planNow: boolean) => void;
}

/**
 * The setup wizard (PLAN §2.1 steps 1–4): diagnose, choose a method, customize, preview the
 * charter. Nothing is written here; the chosen charter goes back to the flow, which writes it
 * through the plan and apply path.
 */
export class SetupWizardModal extends Modal {
  private component: MountedComponent | null = null;

  constructor(
    app: App,
    private readonly options: SetupWizardOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { onSubmit, ...input } = this.options;
    this.setTitle(input.existing ? 'Edit your vault charter' : 'Set up your vault charter');
    this.modalEl.addClass('avo-wizard-modal');
    this.component = mountComponent(SetupWizard, this.contentEl, {
      input,
      submit: (charter: Charter, planNow: boolean) => {
        this.close();
        onSubmit(charter, planNow);
      },
      cancel: () => this.close(),
    });
  }

  override onClose(): void {
    this.component?.destroy();
    this.component = null;
    this.contentEl.empty();
  }
}
