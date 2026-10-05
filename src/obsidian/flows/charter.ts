import { Notice } from 'obsidian';
import { analyzeVault } from '../../core/analysis/analyze';
import { charterPlan } from '../../core/charter/charter-note';
import { type CharterLoad, loadCharter } from '../../core/charter/load';
import type { Charter } from '../../core/charter/schema';
import { formatCharterIssues } from '../../core/charter/summary';
import { computeDrift } from '../../core/drift/drift';
import { plural } from '../../core/model/text';
import { buildRulePlan } from '../../core/planner/rule-plan';
import type AiVaultOrganizerPlugin from '../main';
import { CharterSetupModal } from '../views/charter-setup-modal';
import { DriftModal } from '../views/drift-modal';
import { exclusive } from './exclusive';
import { openReview, runPlan, showRunReport } from './review';

/** `Set up charter`: analyze, let the user choose, write the charter, optionally propose moves. */
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
    new CharterSetupModal(plugin.app, {
      snapshot,
      analysis,
      existing: current.status === 'ok' ? current.charter : null,
      replacesInvalid: current.status === 'invalid',
      charterPath: path,
      onSubmit: (charter, planMoves) =>
        void exclusive(plugin, async () => {
          const saved = await saveCharter(plugin, charter, current);
          if (saved && planMoves) await planRealignment(plugin);
        }),
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

/** Loads a valid charter or tells the user why there is none. */
async function requireCharter(plugin: AiVaultOrganizerPlugin): Promise<{ charter: Charter; path: string } | null> {
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

/** `Check drift`: rule-based drift report with a path to re-alignment. */
export async function checkDrift(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const loaded = await requireCharter(plugin);
  if (!loaded) return;
  const report = computeDrift(await plugin.services.reader.snapshot(), loaded.charter, { charterPath: loaded.path, now: Date.now() });
  new DriftModal(plugin.app, { report, onPlan: () => void planRealignment(plugin) }).open();
}

/** `Plan re-alignment`: everything the rules imply, saved as the pending plan and opened for review. */
export async function planRealignment(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const loaded = await requireCharter(plugin);
  if (!loaded) return;
  const snapshot = await plugin.services.reader.snapshot();
  const plan = buildRulePlan(snapshot, loaded.charter, { charterPath: loaded.path, now: new Date(), createMissingFolders: true });
  if (plan.operations.length === 0) {
    new Notice(`Nothing to re-align: every rule is satisfied.${plan.warnings.length > 0 ? ` ${plan.warnings.map((w) => w.message).join(' ')}` : ''}`);
    return;
  }
  await plugin.services.plans.save(plan);
  await openReview(plugin, plan);
}
