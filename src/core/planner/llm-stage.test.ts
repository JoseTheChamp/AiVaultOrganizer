import { describe, expect, it } from 'vitest';
import { classifyNotesV1 } from '../ai/prompts/classify-notes.v1';
import { presetCharter } from '../charter/presets';
import { testCard } from '../testing/cards';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { InMemoryVault } from '../testing/in-memory-vault';
import { classifyNotes } from './classify';
import { createLlmStage } from './llm-stage';

const answer = (...notes: [string, string, string | null, number][]) =>
  JSON.stringify({ notes: notes.map(([noteId, destinationId, subfolder, confidence]) => ({ noteId, destinationId, subfolder, confidence, rationale: 'Because.' })) });

describe('classify-notes v1', () => {
  const input = {
    language: 'cs' as const,
    method: 'PARA',
    guidance: 'Projects have a goal and an end.',
    targets: [
      { id: 'projects', description: 'Aktivní projekty.', layout: 'subfolder-per-item' as const, subfolders: ['Diplomová práce'], examples: ['Diplomová práce'] },
      { id: 'archive', description: 'Neaktivní věci.', layout: 'flat' as const, subfolders: [], examples: [] },
    ],
    notes: [{ id: 'n1', card: testCard('Koncept.md', 'Koncept komunitního centra v textilce.', { properties: { type: 'note' } }) }],
  };

  it('renders a stable prompt', () => {
    expect(classifyNotesV1.build(input)).toMatchSnapshot();
  });

  it('accepts only shown destinations or abstain, each note exactly once', () => {
    const schema = classifyNotesV1.schema(input);
    expect(schema.safeParse(JSON.parse(answer(['n1', 'projects', 'Diplomová práce', 0.9]))).success).toBe(true);
    expect(schema.safeParse(JSON.parse(answer(['n1', 'abstain', null, 0.3]))).success).toBe(true);
    expect(schema.safeParse(JSON.parse(answer(['n1', 'Projects/Thesis', null, 0.9]))).success).toBe(false);
    expect(schema.safeParse(JSON.parse(answer(['n1', 'projects', null, 1.4]))).success).toBe(false);
    expect(schema.safeParse({ notes: [] }).success).toBe(false);
  });
});

describe('createLlmStage', () => {
  async function run(replies: string[], batchSize = 2, maxContext = 8192, excerpt?: string) {
    const vault = InMemoryVault.from({
      '1 Projects/Website/Website.md': '---\ntype: project\n---\nHub.',
      'a.md': 'Sitemap draft.',
      'b.md': 'Budget numbers.',
      'c.md': 'Unclear.',
      'secret.md': '---\nai-vault-organizer: private\n---\nPrivate.',
    });
    const snapshot = await vault.snapshot();
    const cards = new Map(['a.md', 'b.md', 'c.md', '1 Projects/Website/Website.md'].map((path) => [path, testCard(path, excerpt)]));
    const provider = new ScriptedChatProvider(replies, { maxContext });
    const model = createLlmStage({ provider, cards, folders: snapshot.folders, batchSize });
    const classification = await classifyNotes({ snapshot, charter: presetCharter('para', 'en'), charterPath: null, llm: model.stage });
    return { classification, provider, stats: model.stats };
  }

  it('batches the open notes, withholds private ones and maps answers back', async () => {
    const { classification, provider, stats } = await run([
      answer(['n1', 'projects', 'Website', 0.9], ['n2', 'areas', 'Finances', 0.7]),
      answer(['n1', 'abstain', null, 0.2]),
    ]);
    expect(classification.placements.get('a.md')).toMatchObject({ destination: 'projects', subfolder: 'Website', source: 'llm', confidence: 0.9 });
    expect(classification.placements.get('b.md')).toMatchObject({ destination: 'areas', subfolder: 'Finances', source: 'llm' });
    expect(classification.placements.get('c.md')).toMatchObject({ destination: null, source: null });
    expect(classification.placements.get('secret.md')).toMatchObject({ destination: null });
    expect(stats).toMatchObject({ calls: 2, failures: 0, withheld: 1 });
    const prompt = JSON.stringify(provider.requests);
    expect(prompt).not.toContain('secret');
    // The rule-placed hub shows the model what belongs in projects, and its folder is offered for reuse.
    expect(prompt).toContain('Existing subfolders: Website');
    expect(prompt).toContain('Example notes: Website');
    expect(provider.requests[0]?.prompt).toEqual({ id: 'classify-notes', version: 1 });
  });

  it("makes batches small enough for the model's context window", async () => {
    const notesPerCall = (requests: { messages: { content: string }[] }[]) => requests.map((r) => (r.messages[1]?.content.match(/### Note/g) ?? []).length);
    const all = answer(['n1', 'resources', 'Notes', 0.6], ['n2', 'resources', 'Notes', 0.6], ['n3', 'resources', 'Notes', 0.6]);
    const long = 'A realistic excerpt of a note, several sentences about its subject. '.repeat(6);
    const wide = await run([all], 10, 32_000, long);
    expect(notesPerCall(wide.provider.requests)).toEqual([3]);
    const narrow = await run([answer(['n1', 'resources', 'Notes', 0.6], ['n2', 'resources', 'Notes', 0.6]), answer(['n1', 'resources', 'Notes', 0.6])], 10, 900, long);
    expect(notesPerCall(narrow.provider.requests)).toEqual([2, 1]);
    expect(narrow.stats.failures).toBe(0);
  });

  it('leaves a failed batch undecided and counts it', async () => {
    const { classification, stats } = await run(['nonsense', 'still nonsense', answer(['n1', 'resources', 'Notes', 0.6])]);
    expect(classification.placements.get('a.md')?.destination).toBeNull();
    expect(classification.placements.get('c.md')).toMatchObject({ destination: 'resources', subfolder: 'Notes' });
    expect(stats).toMatchObject({ failures: 1, calls: 3 });
  });
});
