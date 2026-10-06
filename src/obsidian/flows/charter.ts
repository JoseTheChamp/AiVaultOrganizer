import { Notice } from 'obsidian';
import { analyzeVault } from '../../core/analysis/analyze';
import { charterPlan } from '../../core/charter/charter-note';
import { type CharterLoad, loadCharter } from '../../core/charter/load';
import type { Charter } from '../../core/charter/schema';
import { computeDrift } from '../../core/drift/drift';
import type AiVaultOrganizerPlugin from '../main';
import { SetupWizardModal } from '../views/setup-wizard-modal';
import { DriftModal } from '../views/drift-modal';
import { exclusive } from './exclusive';
import { planRealignment } from './plan';
import { requireCharter } from './require-charter';
import { runPlan, showRunReport } from './review';

/** `Set up charter`: the setup wizard, then the charter written through the apply path, then (optionally) a plan for the vault. */
export async function setUpCharter(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const { reader, hasher } = plugin.services;
  const path = plugin.settings.charterPath;
  const notice = new Notice('Analyzing vault…', 0);
  let load: CharterLoad;
  try {
    load = await loadCharter(reader, hasher, path);
    if (load.status === 'no-block') {
      new Notice(`"${path}" exists but is not a charter. Rename it or choose another charter note in the settings.`);
      return;
    }
    const snapshot = await reader.snapshot();
    const analysis = analyzeVault(snapshot, { now: Date.now() });
    const current = load;
    new SetupWizardModal(plugin.app, {
      snapshot,
      analysis,
      existing: current.status === 'ok' ? current.charter : null,
      replacesInvalid: current.status === 'invalid',
      charterPath: path,
      onSubmit: (charter, planNow) =>
        void (async () => {
          let saved = false;
          await exclusive(plugin, async () => {
            saved = await saveCharter(plugin, charter, current);
          });
          // Planning reads the vault and may index it; it changes nothing, so it runs outside the lock.
          if (saved && planNow) await planRealignment(plugin);
        })(),
    }).open();
  } finally {
    notice.hide();
  }
}

async function saveCharter(plugin: AiVaultOrganizerPlugin, charter: Charter, load: CharterLoad): Promise<boolean> {
  const existing = load.status === 'ok' || load.status === 'invalid' ? load.note : null;
  const plan = charterPlan(charter, load.path, existing, new Date());
  if (plan.operations.length === 0) {
    new Notice('The charter is already up to date.');
    return true;
  }
  const accepted = { ...plan, operations: plan.operations.map((op) => ({ ...op, status: 'accepted' as const })) };
  // Writing the charter itself is not limited by the (old) charter's destinations.
  const outcome = await runPlan(plugin, accepted, { ignore: [] });
  if (outcome.kind !== 'ran') return false;
  if (outcome.report.status !== 'completed') {
    showRunReport(plugin, outcome.report, outcome.plan, outcome.backup.key);
    return false;
  }
  new Notice(`Charter saved to "${load.path}".`);
  await plugin.app.workspace.openLinkText(load.path, '', false);
  return true;
}

/** `Check drift`: rule-based drift report with a path to re-alignment. */
export async function checkDrift(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const loaded = await requireCharter(plugin);
  if (!loaded) return;
  const report = computeDrift(await plugin.services.reader.snapshot(), loaded.charter, { charterPath: loaded.path, now: Date.now() });
  new DriftModal(plugin.app, { report, onPlan: () => void planRealignment(plugin) }).open();
}
