import { Notice } from 'obsidian';
import { loadCharter } from '../../core/charter/load';
import type { Charter } from '../../core/charter/schema';
import { formatCharterIssues } from '../../core/charter/summary';
import { plural } from '../../core/model/text';
import type AiVaultOrganizerPlugin from '../main';

/** Loads a valid charter or tells the user why there is none. */
export async function requireCharter(plugin: AiVaultOrganizerPlugin): Promise<{ charter: Charter; path: string } | null> {
  const load = await loadCharter(plugin.services.reader, plugin.services.hasher, plugin.settings.charterPath);
  if (load.status === 'ok') return { charter: load.charter, path: load.path };
  if (load.status === 'missing' || load.status === 'no-block') {
    new Notice('There is no charter yet. Create one with the set up charter command first.');
  } else {
    const [first] = formatCharterIssues(load.issues);
    new Notice(`The charter rules have ${plural(load.issues.length, 'problem')} (${first ?? ''}). Fix them in "${load.path}" first.`);
    await plugin.app.workspace.openLinkText(load.path, '', false);
  }
  return null;
}
