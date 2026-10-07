import { Notice } from 'obsidian';
import { RunBudget } from '../../core/ai/budget';
import { hostOf } from '../../core/ai/endpoint-url';
import type { Charter } from '../../core/charter/schema';
import type { Neighbor } from '../../core/embeddings/top-k';
import type { VaultSnapshot } from '../../core/model/note';
import { plural } from '../../core/model/text';
import { buildCard, type NoteCard } from '../../core/planner/cards';
import { classifyNotes, DEFAULT_KNN, type KnnOptions, type NeighborLookup, WORD_KNN } from '../../core/planner/classify';
import { estimatePlanRun } from '../../core/planner/estimate';
import { buildPlan, type PlannerInput } from '../../core/planner/plan';
import type AiVaultOrganizerPlugin from '../main';
import { askConsent } from '../views/consent-modal';
import { requireCharter } from './require-charter';
import { fallbackMessage, indexingProgress } from './indexing';
import { openReview } from './review';

/**
 * `Plan re-alignment`: the planner's proposal for the whole vault, saved as the pending plan and
 * opened for review. Notes no rule places are compared with placed notes (kNN), by meaning when an
 * embedding model is set up and by shared words otherwise. What is still open then goes to the
 * language model, if one is set up and the user agrees after seeing what would be sent and what it
 * would cost (PLAN §2.1 step 5).
 */
export async function planRealignment(plugin: AiVaultOrganizerPlugin): Promise<void> {
  const loaded = await requireCharter(plugin);
  if (!loaded) return;
  const { reader, similarity, ai, logger } = plugin.services;
  const progress = indexingProgress(plugin);
  try {
    const source = await similarity.neighborSource({ provider: ai.embeddings(), ignore: loaded.charter.ignore, exclude: [loaded.path], ...progress.options });
    const fallback = fallbackMessage(source, hostOf(plugin.settings.ai.embeddings.baseUrl), 'Comparing notes by shared words instead.');
    if (fallback) new Notice(fallback, 10_000);
    const neighbors = remember(source.neighbors);
    const knn = source.method === 'embeddings' ? DEFAULT_KNN : WORD_KNN;
    const snapshot = await reader.snapshot();

    progress.say('Planning…');
    const model = await askForModel(plugin, { snapshot, charter: loaded.charter, charterPath: loaded.path, neighbors, knn }, () => progress.hide());
    if (model === 'cancel') return;
    progress.say(model ? `Planning with ${model.name}…` : 'Planning…');
    const { plan, model: stats } = await buildPlan({
      snapshot,
      charter: loaded.charter,
      charterPath: loaded.path,
      read: (path) => reader.read(path),
      now: new Date(),
      neighbors,
      knn,
      createDestinationFolders: true,
      ...(model ? { model: { ...model, ...(source.method === 'embeddings' ? { embedding: plugin.settings.ai.embeddings.model } : {}) } } : {}),
    });
    progress.hide();
    if (stats && stats.classification.failures > 0) {
      new Notice(`The model could not answer for ${plural(stats.classification.failures, 'batch', 'batches')} of notes; those notes are flagged for you to place.`, 10_000);
    }
    if (plan.operations.length === 0) {
      new Notice(`Nothing to re-align: every note is where the charter puts it.${plan.warnings.length > 0 ? ` ${plan.warnings.map((w) => w.message).join(' ')}` : ''}`);
      return;
    }
    await openReview(plugin, plan);
  } catch (error) {
    logger.error('Planning failed', error);
    new Notice('Planning failed. Enable debug logging and check the developer console for details.');
  } finally {
    progress.hide();
  }
}

interface Cascade {
  snapshot: VaultSnapshot;
  charter: Charter;
  charterPath: string;
  neighbors: NeighborLookup;
  knn: KnnOptions;
}

/**
 * The language model for this run, when one is set up, notes are left for it, and the user agrees;
 * null to plan without it; 'cancel' when the user stops. Runs the cheap stages once to know which
 * notes would be sent (their neighbour lookups are remembered for the real run).
 */
async function askForModel(plugin: AiVaultOrganizerPlugin, cascade: Cascade, beforeAsking: () => void): Promise<PlannerInput['model'] | null | 'cancel'> {
  const settings = plugin.settings.ai;
  const provider = plugin.services.ai.chat({ budget: new RunBudget({ maxTokens: settings.budgetTokens }) });
  if (!provider) return null;
  const { snapshot, charter } = cascade;
  const classification = await classifyNotes({ snapshot, charter, charterPath: cascade.charterPath, neighbors: cascade.neighbors }, cascade.knn);
  const open = snapshot.notes.filter((note) => classification.placements.get(note.path)?.destination === null);
  if (open.length === 0) return null;
  const cards = new Map<string, NoteCard>();
  for (const note of open) {
    const card = buildCard(note, await plugin.services.reader.read(note.path), undefined, { now: Date.now() });
    if (card) cards.set(note.path, card);
  }
  const estimate = estimatePlanRun({ snapshot, charter, classification, cards, folders: snapshot.folders, maxContext: provider.capabilities.maxContext });
  if (estimate.notes === 0) return null;
  beforeAsking();
  const choice = await askConsent(
    plugin.app,
    {
      purpose: 'place the notes your rules and similar notes could not',
      estimate,
      model: settings.chat.model,
      baseUrl: settings.chat.baseUrl,
      localOnly: settings.localOnly,
      prices: { inputPerMillion: settings.inputPricePerMillion, outputPerMillion: settings.outputPricePerMillion },
      budgetTokens: settings.budgetTokens,
    },
    'Without AI',
  );
  if (choice === 'cancel') return 'cancel';
  return choice === 'model' ? { provider, name: settings.chat.model } : null;
}

/** Neighbour lookups are the same in the estimate and the real run; ask the worker once. */
function remember(lookup: (path: string, k: number) => Promise<Neighbor[]>): NeighborLookup {
  const cache = new Map<string, Promise<Neighbor[]>>();
  return (path, k) => {
    const key = `${k}:${path}`;
    let result = cache.get(key);
    if (!result) cache.set(key, (result = lookup(path, k)));
    return result;
  };
}
