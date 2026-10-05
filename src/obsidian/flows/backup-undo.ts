import { Notice } from 'obsidian';
import { plural } from '../../core/model/text';
import type AiVaultOrganizerPlugin from '../main';
import { MessageModal } from '../views/message-modal';
import { exclusive } from './exclusive';

export async function createBackup(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const { backups } = plugin.services;
  const notice = new Notice('Creating backup…', 0);
  try {
    const result = await backups.create({
      pluginVersion: plugin.manifest.version,
      includeAttachments: plugin.settings.backupIncludeAttachments,
    });
    await backups.prune(plugin.settings.backupRetention);
    new Notice(`Backup created: ${plural(result.manifest.files.length, 'file')} in .ai-vault-organizer/${result.key}.`);
  } finally {
    notice.hide();
  }
}

export async function confirmUndo(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const run = await plugin.services.journal.lastUndoableRun();
  if (!run) {
    new Notice('There is no run to undo.');
    return;
  }
  new MessageModal(plugin.app, {
    title: 'Undo last run?',
    paragraphs: [
      `The run from ${new Date(run.run.startedAt).toLocaleString()} made ${plural(run.ops.length, 'change')}. Undo restores the notes exactly as they were before it.`,
      'Notes you edited after the run are left as they are and listed afterwards.',
    ],
    confirm: { label: 'Undo run', warning: true, onConfirm: () => void exclusive(plugin, () => undoRun(plugin, run.run.runId)) },
  }).open();
}

async function undoRun(plugin: AiVaultOrganizerPlugin, runId: string): Promise<void> {
  const notice = new Notice('Undoing run…', 0);
  try {
    const report = await plugin.services.undo.undo(runId);
    new MessageModal(plugin.app, {
      title: report.status === 'completed' ? 'Run undone' : 'Run partly undone',
      paragraphs: [
        `${plural(report.restored, 'change')} reverted.`,
        ...(report.conflicts.length > 0 ? ['These were left alone to protect later changes:'] : []),
      ],
      items: report.conflicts.map((conflict) => `${conflict.path}: ${conflict.reason}`),
    }).open();
  } finally {
    notice.hide();
  }
}
