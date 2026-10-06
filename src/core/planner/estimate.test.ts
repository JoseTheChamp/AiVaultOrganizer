import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { InMemoryVault } from '../testing/in-memory-vault';
import { buildCard, type NoteCard } from './cards';
import { classifyNotes } from './classify';
import { estimatePlanRun } from './estimate';
import { createLlmStage, SECOND_SAMPLE } from './llm-stage';

const files = {
  '1 Projects/Website/Website.md': '---\ntype: project\n---\nRelaunch of the company website.',
  'Sitemap draft.md': 'Pages for the new website: home, pricing, blog.',
  'Budget.md': 'Monthly budget for the household.',
  'Bread.md': 'Sourdough needs a ripe starter and a long proof.',
  'Diary.md': '---\nai-vault-organizer: private\n---\nPrivate thoughts.',
};

async function setup() {
  const vault = InMemoryVault.from(files);
  const snapshot = await vault.snapshot();
  const cards = new Map<string, NoteCard>();
  for (const note of snapshot.notes) {
    const card = buildCard(note, await vault.read(note.path));
    if (card) cards.set(note.path, card);
  }
  const charter = presetCharter('para', 'en');
  const classification = await classifyNotes({ snapshot, charter, charterPath: null });
  return { snapshot, charter, cards, classification };
}

describe('estimatePlanRun', () => {
  it('counts the open notes it would send, never the private ones', async () => {
    const { snapshot, charter, cards, classification } = await setup();
    const estimate = estimatePlanRun({ snapshot, charter, classification, cards, folders: snapshot.folders, maxContext: 8192 });
    expect(estimate).toMatchObject({ notes: 3, withheld: 1 });
    // One batch and the summary at least; at most a second sample, naming for three item and
    // topic destinations, and the summary.
    expect(estimate.calls).toEqual({ min: 2, max: 6 });
    expect(estimate.inputTokens.max).toBeGreaterThan(estimate.inputTokens.min);
  });

  it('bounds what the model stage then actually sends', async () => {
    const { snapshot, charter, cards, classification } = await setup();
    const estimate = estimatePlanRun({ snapshot, charter, classification, cards, folders: snapshot.folders, maxContext: 8192 });
    const answer = (...ids: string[]) => JSON.stringify({ notes: ids.map((noteId) => ({ noteId, rationale: 'r', destinationId: 'resources', subfolder: null, confidence: 0.9 })) });
    const provider = new ScriptedChatProvider([answer('n1', 'n2', 'n3'), answer('n1', 'n2', 'n3')]);
    const stage = createLlmStage({ provider, cards, folders: snapshot.folders, secondSample: SECOND_SAMPLE });
    await classifyNotes({ snapshot, charter, charterPath: null, llm: stage.stage });
    expect(stage.stats.calls).toBeGreaterThanOrEqual(estimate.calls.min - 1);
    expect(stage.stats.calls).toBeLessThanOrEqual(estimate.calls.max);
  });

  it('is empty when rules and similar notes leave nothing open', async () => {
    const vault = InMemoryVault.from({ '1 Projects/A/A.md': '---\ntype: project\n---\n' });
    const snapshot = await vault.snapshot();
    const charter = presetCharter('para', 'en');
    const classification = await classifyNotes({ snapshot, charter, charterPath: null });
    expect(estimatePlanRun({ snapshot, charter, classification, cards: new Map(), folders: [], maxContext: 8192 }).calls).toEqual({ min: 0, max: 0 });
  });
});
