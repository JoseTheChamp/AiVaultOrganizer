import { analyze } from './flows/analyze';
import { confirmUndo, createBackup } from './flows/backup-undo';
import { checkDrift, setUpCharter } from './flows/charter';
import { planRealignment } from './flows/plan';
import { exclusive } from './flows/exclusive';
import { reviewPendingPlan } from './flows/review';
import { findSimilarNotes } from './flows/similar';
import type AiVaultOrganizerPlugin from './main';

/** Registers the command palette entries. Ids omit the plugin id; Obsidian prefixes them. */
export function registerCommands(plugin: AiVaultOrganizerPlugin): void {
  plugin.addCommand({ id: 'open-dashboard', name: 'Open dashboard', callback: () => void plugin.openDashboard() });
  plugin.addCommand({ id: 'set-up-ai', name: 'Set up AI', callback: () => void plugin.openAiSetup() });
  plugin.addCommand({ id: 'analyze-vault', name: 'Analyze vault', callback: () => void analyze(plugin) });
  plugin.addCommand({ id: 'set-up-charter', name: 'Set up charter', callback: () => void setUpCharter(plugin) });
  plugin.addCommand({ id: 'check-drift', name: 'Check drift', callback: () => void checkDrift(plugin) });
  plugin.addCommand({ id: 'plan-realignment', name: 'Organize vault', callback: () => void planRealignment(plugin) });
  plugin.addCommand({ id: 'review-pending-plan', name: 'Review pending plan', callback: () => void reviewPendingPlan(plugin) });
  plugin.addCommand({ id: 'create-backup', name: 'Create backup', callback: () => void exclusive(plugin, () => createBackup(plugin)) });
  plugin.addCommand({ id: 'undo-last-run', name: 'Undo last run', callback: () => void confirmUndo(plugin) });
  plugin.addCommand({
    id: 'find-similar-notes',
    name: 'Find similar notes',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== 'md') return false;
      if (!checking) void findSimilarNotes(plugin, file);
      return true;
    },
  });
}
