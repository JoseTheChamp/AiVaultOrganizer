import { Notice } from 'obsidian';
import type AiVaultOrganizerPlugin from '../main';

/** Runs one vault-changing task at a time; a second request while one runs is refused. */
export async function exclusive(plugin: AiVaultOrganizerPlugin, task: () => Promise<void>): Promise<void> {
  if (plugin.busy) {
    new Notice('Another vault operation is still running. Try again when it has finished.');
    return;
  }
  plugin.busy = true;
  plugin.changed();
  try {
    await task();
  } catch (error) {
    plugin.services.logger.error('Vault operation failed', error);
    new Notice('The operation failed. Enable debug logging and check the developer console for details.');
  } finally {
    plugin.busy = false;
    plugin.changed();
  }
}
