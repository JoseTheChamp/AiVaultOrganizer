import { debounce, ItemView, type WorkspaceLeaf } from 'obsidian';
import { loadCharter } from '../../core/charter/load';
import Dashboard from '../../ui/dashboard/Dashboard.svelte';
import { type DashboardActions, type DashboardModel, dashboardState } from '../../ui/dashboard/dashboard-state';
import { type MountedComponent, mountComponent } from '../../ui/mount';
import { reactive } from '../../ui/reactive.svelte';
import { analyze } from '../flows/analyze';
import { confirmUndo } from '../flows/backup-undo';
import { setUpCharter } from '../flows/charter';
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
  private readonly model = reactive<DashboardModel>({ state: null, error: null, busy: false });

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
      refresh: () => void this.refresh(),
      analyze: () => void analyze(plugin),
      setUp: () => void setUpCharter(plugin),
      openCharter: () => void this.app.workspace.openLinkText(plugin.settings.charterPath, '', false),
      plan: () => void planRealignment(plugin),
      review: () => void reviewPendingPlan(plugin),
      undo: () => void confirmUndo(plugin),
      setUpAi: () => void plugin.openAiSetup(),
    };
    this.contentEl.empty();
    this.component = mountComponent(Dashboard, this.contentEl, { model: this.model, actions });
    const later = debounce(() => void this.refresh(), 2000, true);
    this.registerEvent(plugin.changes.on('changed', () => void this.refresh()));
    this.registerEvent(this.app.metadataCache.on('resolved', later));
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.component?.destroy();
    this.component = null;
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
