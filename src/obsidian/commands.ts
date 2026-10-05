import { Notice } from 'obsidian';
import { analyzeVault } from '../core/analysis/analyze';
import type AiVaultOrganizerPlugin from './main';
import { DiagnosticsModal } from './views/diagnostics-modal';

/** Registers the command palette entries. Ids omit the plugin id; Obsidian prefixes them. */
export function registerCommands(plugin: AiVaultOrganizerPlugin): void {
  plugin.addCommand({
    id: 'analyze-vault',
    name: 'Analyze vault',
    callback: () => {
      void analyze(plugin);
    },
  });
}

async function analyze(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const notice = new Notice('Analyzing vault…', 0);
  try {
    const started = Date.now();
    const snapshot = await plugin.services.reader.snapshot();
    const analysis = analyzeVault(snapshot, { now: Date.now() });
    plugin.services.logger.debug(`Analyzed ${snapshot.notes.length} notes in ${Date.now() - started} ms`);
    new DiagnosticsModal(plugin.app, analysis).open();
  } catch (error) {
    plugin.services.logger.error('Vault analysis failed', error);
    new Notice('Vault analysis failed. Enable debug logging and check the developer console for details.');
  } finally {
    notice.hide();
  }
}
