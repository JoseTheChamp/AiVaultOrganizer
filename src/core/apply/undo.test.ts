import { describe, expect, it } from 'vitest';
import { wrapGeneratedSection } from '../markdown/generated-sections';
import { acceptedOp, applyHarness, planOf } from '../testing/apply-harness';
import { UndoService } from './undo';

function setup(files: Record<string, string>, folders: string[] = []) {
  const harness = applyHarness(files, folders);
  const undo = new UndoService(harness.deps);
  return { ...harness, undo };
}

const files = {
  'Inbox/Idea.md': '# Idea\nSee [[Site]].',
  'Projects/Site.md': '---\ntags: [web]  # keep this comment\n---\n# Site\nRefers to [[Inbox/Idea]] and #ProjectX.',
  'Charter.md': `Mine\n${wrapGeneratedSection('overview', 'old')}\n`,
  'Home.md': '[[Idea]] and [[Inbox/Idea|the idea]]',
};

const fullPlan = () =>
  planOf([
    acceptedOp({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/Ideas/Idea.md' }),
    acceptedOp({ kind: 'setProperty', path: 'Projects/Ideas/Idea.md', key: 'type', value: 'idea' }),
    acceptedOp({ kind: 'addTags', path: 'Projects/Site.md', tags: ['site'] }),
    acceptedOp({ kind: 'replaceTag', path: 'Projects/Site.md', from: 'ProjectX', to: 'project-x' }),
    acceptedOp({ kind: 'addRelatedLinks', path: 'Projects/Ideas/Idea.md', heading: '## Related', targets: ['Charter.md'] }),
    acceptedOp({ kind: 'createNote', path: 'Maps/Projects.md', role: 'moc', content: '# Projects' }),
    acceptedOp({ kind: 'updateGeneratedSection', path: 'Charter.md', sectionId: 'overview', content: 'new' }),
  ]);

describe('UndoService', () => {
  it('restores byte-identical notes and the original folders', async () => {
    const { vault, executor, undo } = setup(files, ['Empty']);
    const before = vault.contents();
    const folders = vault.folderPaths();

    const report = await executor.apply(fullPlan());
    expect(report.status).toBe('completed');
    expect(vault.contents()).not.toEqual(before);
    expect(await vault.read('Home.md')).toBe('[[Idea]] and [[Idea|the idea]]');

    const result = await undo.undoLast();
    expect(result).toMatchObject({ status: 'completed', conflicts: [] });
    expect(vault.contents()).toEqual(before);
    expect(vault.folderPaths()).toEqual(folders);
    expect(vault.trash.map((t) => t.path)).toEqual(['Maps/Projects.md']);
  });

  it('never overwrites edits made after the run and reports them', async () => {
    const { vault, executor, undo } = setup(files);
    await executor.apply(fullPlan());
    vault.setFile('Projects/Site.md', 'the user rewrote this');
    vault.setFile('Maps/Projects.md', '# Projects\nmy own notes');

    const result = await undo.undoLast();
    expect(result?.status).toBe('partial');
    expect(result?.conflicts.map((c) => [c.path, c.reason])).toEqual([
      // createNote's own inverses come first (newest op): the note, then its new folder.
      ['Maps/Projects.md', 'Kept: you edited this note after it was created.'],
      ['Maps', 'Kept: the folder is not empty.'],
      ['Projects/Site.md', 'Skipped: the note was edited after the run.'],
      ['Projects/Site.md', 'Skipped: the note was edited after the run.'],
    ]);
    expect(await vault.read('Projects/Site.md')).toBe('the user rewrote this');
    expect(await vault.read('Maps/Projects.md')).toBe('# Projects\nmy own notes');
    // Unrelated changes were still undone.
    expect(await vault.exists('Inbox/Idea.md')).toBe(true);
    expect(await vault.read('Charter.md')).toBe(files['Charter.md']);
  });

  it('keeps a moved note in place when its original path got occupied', async () => {
    const { vault, executor, undo } = setup({ 'a.md': 'x' });
    await executor.apply(planOf([acceptedOp({ kind: 'move', from: 'a.md', to: 'B/a.md' })]));
    vault.setFile('a.md', 'a new note with the old name');
    const result = await undo.undoLast();
    expect(result?.conflicts[0]?.reason).toBe('Kept: "a.md" is occupied by another file now.');
    expect(await vault.read('B/a.md')).toBe('x');
  });

  it('lets Obsidian keep link updates in backlinking notes the user edited', async () => {
    const { vault, executor, undo } = setup({ 'A/Note.md': '', 'B/Other.md': '', 'Home.md': '[[Other]]' });
    await executor.apply(planOf([acceptedOp({ kind: 'move', from: 'B/Other.md', to: 'B/Note.md' })]));
    vault.setFile('Home.md', '[[B/Note]] plus my edit');
    await undo.undoLast();
    expect(await vault.exists('B/Other.md')).toBe(true);
    expect(await vault.read('Home.md')).toBe('[[Other]] plus my edit');
  });

  it('restores links that a move redirected to the moved note', async () => {
    // Found by the round-trip property test: from C/Alpha.md, [[Alpha]] resolves to itself until a
    // note named Alpha moves to the vault root and the same text starts resolving to that note.
    const { vault, executor, undo, journal } = setup({ 'A/B/Alpha.md': '# Alpha\n', 'C/Alpha.md': 'See [[Alpha]].\n' });
    const before = vault.contents();
    const run = await executor.apply(planOf([acceptedOp({ kind: 'move', from: 'A/B/Alpha.md', to: 'Alpha.md' })]));
    const moveBack = (await journal.read(run.runId)).ops[0]?.inverses.find((i) => i.type === 'moveBack');
    expect(moveBack).toMatchObject({ redirected: [{ path: 'C/Alpha.md' }] });
    await undo.undoLast();
    expect(vault.contents()).toEqual(before);
  });

  it('undoes partial runs and refuses to undo twice', async () => {
    const { vault, executor, undo, journal } = setup({ 'a.md': '', 'b.md': '' });
    vault.failNextWriteTo = 'b.md';
    const run = await executor.apply(
      planOf([
        acceptedOp({ kind: 'setProperty', path: 'a.md', key: 'k', value: 1 }),
        acceptedOp({ kind: 'setProperty', path: 'b.md', key: 'k', value: 1 }),
      ]),
    );
    expect(run.status).toBe('failed');
    expect(await undo.undo(run.runId)).toMatchObject({ status: 'completed', restored: 1 });
    expect(vault.contents()).toEqual({ 'a.md': '', 'b.md': '' });
    expect(await undo.undo(run.runId)).toMatchObject({ status: 'already-undone' });
    expect(await journal.lastUndoableRun()).toBeNull();
    expect(await undo.undoLast()).toBeNull();
  });
});
