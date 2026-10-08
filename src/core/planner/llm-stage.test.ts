import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { classifyNotesV2 } from '../ai/prompts/classify-notes.v2';
import { presetCharter } from '../charter/presets';
import { testCard } from '../testing/cards';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { InMemoryVault } from '../testing/in-memory-vault';
import { classifyNotes } from './classify';
import { createLlmStage, SECOND_SAMPLE } from './llm-stage';

const answer = (...notes: [string, string, string | null, number][]) =>
  JSON.stringify({ notes: notes.map(([noteId, destinationId, subfolder, confidence]) => ({ noteId, rationale: 'Because.', destinationId, subfolder, confidence })) });

describe('classify-notes v2', () => {
  const input = {
    language: 'cs' as const,
    method: 'PARA',
    guidance: 'Projects have a goal and an end.',
    targets: [
      { id: 'projects', description: 'Aktivní projekty.', layout: 'subfolder-per-item' as const, onlyFor: null, subfolders: ['Diplomová práce'], examples: ['Diplomová práce'] },
      { id: 'meetings', description: 'Schůzky.', layout: 'flat' as const, onlyFor: 'notes whose type is meeting.', subfolders: [], examples: [] },
      { id: 'archive', description: 'Neaktivní věci.', layout: 'flat' as const, onlyFor: null, subfolders: [], examples: [] },
    ],
    notes: [{ id: 'n1', card: testCard('Koncept.md', 'Koncept komunitního centra v textilce.', { properties: { type: 'note' } }) }],
  };

  it('renders a stable prompt', () => {
    expect(classifyNotesV2.build(input)).toMatchSnapshot();
  });

  it('asks for every field, the rationale before the decision', () => {
    const json = JSON.stringify(z.toJSONSchema(classifyNotesV2.schema(input)));
    expect(json).toContain('"required":["noteId","rationale","destinationId","subfolder","confidence"]');
    expect(classifyNotesV2.schema(input).safeParse({ notes: [{ noteId: 'n1', rationale: 'Proč.', destinationId: 'archive', confidence: 0.6 }] }).success).toBe(false);
  });

  it('accepts only shown destinations or abstain, each note exactly once', () => {
    const schema = classifyNotesV2.schema(input);
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
    expect(classification.placements.get('a.md')).toMatchObject({ destination: 'projects', subfolder: 'Website', source: 'llm', signals: { llm: { confidence: 0.9 } } });
    expect(classification.placements.get('a.md')?.confidence).toBeCloseTo(0.74, 10);
    expect(classification.placements.get('b.md')).toMatchObject({ destination: 'areas', subfolder: 'Finances', source: 'llm' });
    expect(classification.placements.get('c.md')).toMatchObject({ destination: null, source: null });
    expect(classification.placements.get('secret.md')).toMatchObject({ destination: null });
    expect(stats).toMatchObject({ calls: 2, failures: 0, withheld: 1 });
    const prompt = JSON.stringify(provider.requests);
    expect(prompt).not.toContain('secret');
    // The rule-placed hub shows the model what belongs in projects, and its folder is offered for reuse.
    expect(prompt).toContain('Subfolders in use: Website');
    expect(prompt).toContain('Example notes: Website');
    expect(provider.requests[0]?.prompt).toEqual({ id: 'classify-notes', version: 2 });
    // A subfolder proposed in one batch is offered to the next.
    expect(provider.requests[1]?.messages[1]?.content).toContain('Subfolders in use: Website');
    expect(provider.requests[1]?.messages[1]?.content).toMatch(/- areas: .*\n {2}Subfolders in use: Finances/);
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

  it('files a note with the project its subfolder names, wherever the model put it', async () => {
    const { classification } = await run([answer(['n1', 'resources', 'website', 0.9], ['n2', 'areas', 'Finances', 0.7]), answer(['n1', 'archive', null, 0.9])]);
    // "Website" is a project in use under projects only, so the note goes there.
    expect(classification.placements.get('a.md')).toMatchObject({ destination: 'projects', subfolder: 'website', source: 'llm' });
    // A new subfolder names no item yet: the model's choice stands.
    expect(classification.placements.get('b.md')).toMatchObject({ destination: 'areas', subfolder: 'Finances' });
  });

  it('counts answered notes per pass, so a second opinion never runs the count backwards', async () => {
    const vault = InMemoryVault.from({ 'a.md': 'A.', 'b.md': 'B.', 'c.md': 'C.' });
    const snapshot = await vault.snapshot();
    const cards = new Map(['a.md', 'b.md', 'c.md'].map((path) => [path, testCard(path)]));
    const provider = new ScriptedChatProvider([
      answer(['n1', 'projects', null, 0.6], ['n2', 'areas', null, 0.97]),
      answer(['n1', 'resources', null, 0.5]),
      // The borderline notes, c and a, asked again in one batch.
      answer(['n1', 'resources', null, 0.5], ['n2', 'projects', null, 0.6]),
    ]);
    const seen: string[] = [];
    const model = createLlmStage({ provider, cards, folders: [], batchSize: 2, secondSample: SECOND_SAMPLE, onProgress: ({ pass, done, total }) => seen.push(`${pass} ${done}/${total}`) });
    await classifyNotes({ snapshot, charter: presetCharter('para', 'en'), charterPath: null, llm: model.stage });
    expect(seen).toEqual(['placing 0/3', 'placing 2/3', 'placing 3/3', 'double-checking 0/2', 'double-checking 2/2']);
  });

  it('leaves a failed batch undecided and counts it', async () => {
    const { classification, stats } = await run(['nonsense', 'still nonsense', answer(['n1', 'resources', 'Notes', 0.6])]);
    expect(classification.placements.get('a.md')?.destination).toBeNull();
    expect(classification.placements.get('c.md')).toMatchObject({ destination: 'resources', subfolder: 'Notes' });
    expect(stats).toMatchObject({ failures: 1, calls: 3 });
  });
});
