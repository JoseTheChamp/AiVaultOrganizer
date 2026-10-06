import { describe, expect, it } from 'vitest';
import { ApplyRunService } from '../apply/run';
import { presetCharter } from '../charter/presets';
import type { Charter } from '../charter/schema';
import { createOperation, type Operation } from '../model/operation';
import { createPlan } from '../model/plan';
import { applyHarness } from '../testing/apply-harness';
import { mocOperations, pathsAfter } from './mocs';
import { charterRoots } from './rule-plan';

const topics = presetCharter('topics', 'en');

describe('mocOperations (folders)', () => {
  const files = {
    'Notes/Cooking/Soup.md': 'Soup.',
    'Notes/Cooking/Bread.md': 'Bread.',
    'Notes/Garden/Tomatoes.md': 'Tomatoes.',
    'Notes/Loose.md': 'Loose.',
    'Inbox/Pasta.md': 'Pasta.',
    'Other/Soup.md': 'Another soup.',
  };

  it('lists each destination after the planned moves, a section per subfolder', async () => {
    const { vault } = applyHarness(files);
    const snapshot = await vault.snapshot();
    const move = createOperation({ kind: 'move', from: 'Inbox/Pasta.md', to: 'Notes/Cooking/Pasta.md' });
    const operations = await mocOperations({ snapshot, charter: topics, operations: [move], read: (p) => vault.read(p) });
    expect(operations).toHaveLength(1);
    const note = operations[0] as Extract<Operation, { kind: 'createNote' }>;
    expect(note).toMatchObject({ kind: 'createNote', path: 'Notes/Notes.md', role: 'moc' });
    expect(note.content).toBe(
      [
        '---',
        'type: moc',
        '---',
        '# Notes',
        '',
        '<!-- charter:generated:start id="moc" -->',
        '- [[Loose]]',
        '',
        '## Cooking',
        '- [[Bread]]',
        '- [[Pasta]]',
        // Another note is called Soup, so this link says which one.
        '- [[Notes/Cooking/Soup|Soup]]',
        '',
        '## Garden',
        '- [[Tomatoes]]',
        '<!-- charter:generated:end -->',
        '',
      ].join('\n'),
    );
    expect(pathsAfter(snapshot, [move]).get('Inbox/Pasta.md')).toBe('Notes/Cooking/Pasta.md');
  });

  it('updates only the generated section of an existing map, and never a note without one', async () => {
    const { vault, deps, storage, clock } = applyHarness({
      ...files,
      'Notes/Notes.md': '# Notes\nMy intro.\n\n<!-- charter:generated:start id="moc" -->\n- [[Old]]\n<!-- charter:generated:end -->\n\nMy outro.',
    });
    const operations = await mocOperations({ snapshot: await vault.snapshot(), charter: topics, operations: [], read: (p) => vault.read(p) });
    expect(operations.map((op) => op.kind)).toEqual(['updateGeneratedSection']);
    const plan = createPlan({ id: 'moc', createdAt: '2026-10-07T00:00:00.000Z', operations: operations.map((op) => ({ ...op, status: 'accepted' as const })) });
    await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'test' });
    const content = await vault.read('Notes/Notes.md');
    expect(content).toContain('My intro.');
    expect(content).toContain('My outro.');
    expect(content).toContain('- [[Tomatoes]]');
    expect(content).not.toContain('[[Old]]');
    expect(await mocOperations({ snapshot: await vault.snapshot(), charter: topics, operations: [], read: (p) => vault.read(p) })).toEqual([]);

    const userNote = applyHarness({ ...files, 'Notes/Notes.md': '# My own index' });
    expect(await mocOperations({ snapshot: await userNote.vault.snapshot(), charter: topics, operations: [], read: (p) => userNote.vault.read(p) })).toEqual([]);
  });

  it('writes to the charter MOC folder when maps are not kept per destination, and does nothing when disabled', async () => {
    const { vault } = applyHarness({ 'Atlas/Notes/Cooking/Soup.md': 'Soup.' });
    const ace = presetCharter('ace', 'en');
    const operations = await mocOperations({ snapshot: await vault.snapshot(), charter: ace, operations: [], read: (p) => vault.read(p) });
    expect(operations.map((op) => (op.kind === 'createNote' || op.kind === 'createFolder' ? op.path : op.kind))).toEqual(['Atlas/Maps', 'Atlas/Maps/Notes.md']);
    const off: Charter = { ...topics, mocs: { enabled: false, perDestination: true } };
    expect(await mocOperations({ snapshot: await vault.snapshot(), charter: off, operations: [], read: (p) => vault.read(p) })).toEqual([]);
  });
});

describe('mocOperations (properties mode)', () => {
  it('creates a category note with a Bases view for every category used but missing', async () => {
    const { vault, deps, storage, clock } = applyHarness({
      'Habits.md': '---\ncategories: ["[[Books]]"]\n---\nA book.',
      'Mia.md': '---\ncategories: ["[[People]]", "[[Books]]"]\n---\nA person.',
      'Categories/People.md': 'Already here.',
    });
    const charter = presetCharter('flat-categories', 'en');
    const operations = await mocOperations({ snapshot: await vault.snapshot(), charter, operations: [], read: (p) => vault.read(p) });
    expect(operations).toEqual([expect.objectContaining({ kind: 'createNote', path: 'Categories/Books.md', role: 'category' })]);
    const note = operations[0] as Extract<Operation, { kind: 'createNote' }>;
    expect(note.content).toContain('categories.contains(link("Books"))');
    const plan = createPlan({ id: 'cat', createdAt: '2026-10-07T00:00:00.000Z', operations: operations.map((op) => ({ ...op, status: 'accepted' as const })) });
    const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'test', allowedRoots: charterRoots(charter) });
    expect(outcome.kind === 'ran' && outcome.report.status).toBe('completed');
  });
});
