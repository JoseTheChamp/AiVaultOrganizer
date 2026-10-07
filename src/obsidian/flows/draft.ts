import { Notice } from 'obsidian';
import { agentContext, estimateAgentRun } from '../../core/ai/agent/context';
import { DEFAULT_AGENT, draftCharter } from '../../core/ai/agent/charter-agent';
import { RunBudget } from '../../core/ai/budget';
import { clusterWords } from '../../core/analysis/clusters';
import type { Lang } from '../../core/charter/presets';
import type { Charter } from '../../core/charter/schema';
import type { WizardInput } from '../../ui/wizard/wizard-state';
import type AiVaultOrganizerPlugin from '../main';
import { askConsent } from '../views/consent-modal';
import { indexingProgress } from './indexing';

/**
 * "Ask the AI for a draft" in the setup wizard (PLAN §2.1 step 2, §7.7): groups similar notes by
 * shared words, asks before sending samples of them, and lets the drafting agent propose a charter.
 * Returns the draft for the wizard to show, or null when the user declines or the agent fails.
 */
export async function draftCharterWithAI(plugin: AiVaultOrganizerPlugin, wizard: WizardInput, language: Lang, wish: string): Promise<Charter | null> {
  // Without a language model, set one up first; the suggestion continues when that works.
  if (!plugin.services.ai.chat() && !(await plugin.openAiSetup())) return null;
  const settings = plugin.settings.ai;
  const provider = plugin.services.ai.chat({ budget: new RunBudget({ maxTokens: DEFAULT_AGENT.maxTokens }) });
  if (!provider) return null;
  const progress = indexingProgress(plugin);
  try {
    const model = await plugin.services.similarity.wordModel({ ignore: wizard.existing?.ignore ?? [], ...progress.options });
    progress.say('Grouping similar notes…');
    const { context, withheld } = await agentContext({
      analysis: wizard.analysis,
      snapshot: wizard.snapshot,
      clustering: clusterWords(model),
      read: (path) => plugin.services.reader.read(path),
      language,
      now: Date.now(),
    });
    progress.hide();
    const choice = await askConsent(
      plugin.app,
      {
        purpose: 'propose a charter from groups of similar notes, reading samples of them',
        estimate: estimateAgentRun(context, withheld),
        model: settings.chat.model,
        baseUrl: settings.chat.baseUrl,
        localOnly: settings.localOnly,
        prices: { inputPerMillion: settings.inputPricePerMillion, outputPerMillion: settings.outputPricePerMillion },
        budgetTokens: settings.budgetTokens,
      },
      'Not now',
    );
    if (choice !== 'model') return null;
    progress.say(`${settings.chat.model} is drafting a charter…`);
    const result = await draftCharter(provider, context, wish);
    if (result.ok) return result.charter;
    plugin.services.logger.warn('Charter draft failed', { reason: result.reason, problems: result.lastProblems });
    new Notice(`The model did not produce a valid charter (${result.reason}). Choose a method yourself, or try again.`, 10_000);
    return null;
  } catch (error) {
    plugin.services.logger.error('Charter draft failed', error);
    new Notice('The draft failed. Enable debug logging and check the developer console for details.');
    return null;
  } finally {
    progress.hide();
  }
}
