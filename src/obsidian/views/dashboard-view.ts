import { debounce, ItemView, type WorkspaceLeaf } from 'obsidian';
import { loadCharter } from '../../core/charter/load';
import Dashboard from '../../ui/dashboard/Dashboard.svelte';
import { type DashboardActions, type DashboardModel, dashboardState } from '../../ui/dashboard/dashboard-state';
import { type MountedComponent, mountComponent } from '../../ui/mount';
import { reactive } from '../../ui/reactive.svelte';
import { analyze } from '../flows/analyze';
import { confirmUndo } from '../flows/backup-undo';
import { organizeAgain, setUpCharter } from '../flows/charter';
import { planRealignment } from '../flows/plan';
import { reviewPendingPlan } from '../flows/review';
import type AiVaultOrganizerPlugin from '../main';

export const DASHBOARD_VIEW = 'ai-vault-organizer-dashboard';

/**
 * The sidebar dashboard (PLAN §9.1): health, charter and drift, a waiting plan, the last run and
 * the AI setup, with the commands that act on them. Refreshes when the plugin reports a change and,
 * debounced, when notes change.
 */
export class DashboardView extends ItemView {
  private component: MountedComponent | null = null;
  private readonly model = reactive<DashboardModel>({ state: null, error: null, busy: false, activity: null, aiStatus: null });
  private checking = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AiVaultOrganizerPlugin,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return DASHBOARD_VIEW;
  }

  override getDisplayText(): string {
    return 'Vault organizer';
  }

  override getIcon(): string {
    return 'layout-dashboard';
  }

  override async onOpen(): Promise<void> {
    const { plugin } = this;
    const actions: DashboardActions = {
      refresh: () => {
        void this.refresh();
        void this.checkAi();
      },
      analyze: () => void analyze(plugin),
      setUp: () => void setUpCharter(plugin),
      openCharter: () => void this.app.workspace.openLinkText(plugin.settings.charterPath, '', false),
      plan: () => void planRealignment(plugin),
      organizeAgain: () => void organizeAgain(plugin),
      review: () => void reviewPendingPlan(plugin),
      undo: () => void confirmUndo(plugin),
      setUpAi: () => void plugin.openAiSetup(),
      stop: () => plugin.stop(),
    };
    this.contentEl.empty();
    this.component = mountComponent(Dashboard, this.contentEl, { model: this.model, actions });
    const later = debounce(() => void this.refresh(), 2000, true);
    this.registerEvent(
      plugin.changes.on('changed', () => {
        void this.refresh();
        void this.checkAi();
      }),
    );
    this.registerEvent(plugin.changes.on('activity', () => (this.model.activity = plugin.activity)));
    this.registerEvent(this.app.metadataCache.on('resolved', later));
    // The status light stays current while the dashboard is open: a free model-list request a minute.
    this.registerInterval(window.setInterval(() => void this.checkAi(), 60_000));
    this.model.activity = plugin.activity;
    await Promise.all([this.refresh(), this.checkAi()]);
  }

  override async onClose(): Promise<void> {
    this.component?.destroy();
    this.component = null;
  }

  /** Asks the language model whether it answers; never overlaps with a check already running. */
  private async checkAi(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      this.model.aiStatus = await this.plugin.services.ai.status();
    } catch (error) {
      this.plugin.services.logger.warn('AI status check failed', error);
    } finally {
      this.checking = false;
    }
  }

  private async refresh(): Promise<void> {
    const { services, settings } = this.plugin;
    try {
      const [snapshot, charter, runIds, undoable, pendingPlan] = await Promise.all([
        services.reader.snapshot(),
        loadCharter(services.reader, services.hasher, settings.charterPath),
        services.journal.runIds(),
        services.journal.lastUndoableRun(),
        services.plans.latest(),
      ]);
      const lastRun = runIds[0] ? await services.journal.read(runIds[0]) : null;
      this.model.state = dashboardState({ snapshot, charter, lastRun, canUndo: undoable !== null, pendingPlan, ai: settings.ai, now: Date.now() });
      this.model.error = null;
    } catch (error) {
      services.logger.error('Dashboard refresh failed', error);
      this.model.error = 'The dashboard could not read the vault. Enable debug logging and check the developer console.';
    }
    this.model.busy = this.plugin.busy;
  }
}
