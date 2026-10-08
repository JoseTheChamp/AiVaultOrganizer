import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../hash';
import { wrapGeneratedSection } from '../markdown/generated-sections';
import { createOperation } from '../model/operation';
import { acceptedOp, applyHarness, planOf } from '../testing/apply-harness';

describe('ApplyExecutor', () => {
  it('applies every operation kind in phase order and journals inverses', async () => {
    const { vault, journal, executor } = applyHarness({
      'Inbox/Idea.md': '# Idea\nSee [[Site]].',
      'Projects/Site.md': '---\ntags: [web]\n---\n# Site\nRefers to [[Idea]] and #ProjectX.',
      'Charter.md': `Mine\n${wrapGeneratedSection('overview', 'old')}\n`,
    });
    const plan = planOf([
      // Deliberately out of order: the executor sorts by phase.
      acceptedOp({ kind: 'addRelatedLinks', path: 'Projects/Ideas/Idea.md', heading: '## Related', targets: ['Charter.md'] }),
      acceptedOp({ kind: 'setProperty', path: 'Projects/Ideas/Idea.md', key: 'type', value: 'idea' }),
      acceptedOp({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/Ideas/Idea.md' }),
      acceptedOp({ kind: 'addTags', path: 'Projects/Site.md', tags: ['web', 'site'] }),
      acceptedOp({ kind: 'replaceTag', path: 'Projects/Site.md', from: 'ProjectX', to: 'project-x' }),
      acceptedOp({ kind: 'createNote', path: 'Maps/Projects.md', role: 'moc', content: '# Projects\n- [[Site]]\n' }),
      acceptedOp({ kind: 'updateGeneratedSection', path: 'Charter.md', sectionId: 'overview', content: 'new' }),
      acceptedOp({ kind: 'flag', path: 'Charter.md', issue: 'orphan' }),
    ]);

    const report = await executor.apply(plan, { runId: 'run-1' });

    expect(report).toMatchObject({ status: 'completed', applied: 7, skipped: 0, failed: 0 });
    expect(vault.contents()).toEqual({
      'Charter.md': `Mine\n${wrapGeneratedSection('overview', 'new')}\n`,
      'Maps/Projects.md': '# Projects\n- [[Site]]\n',
      'Projects/Ideas/Idea.md': '---\ntype: idea\n---\n# Idea\nSee [[Site]].\n\n## Related\n- [[Charter]]\n',
      'Projects/Site.md': '---\ntags:\n  - web\n  - site\n---\n# Site\nRefers to [[Idea]] and #project-x.',
    });
    const run = await journal.read('run-1');
    expect(run.ops.map((op) => op.kind)).toEqual([
      'move',
      'setProperty',
      'addTags',
      'replaceTag',
      'addRelatedLinks',
      'createNote',
      'updateGeneratedSection',
    ]);
    expect(run.ops[0]?.inverses).toMatchObject([{ type: 'removeFolder', path: 'Projects/Ideas' }, { type: 'moveBack' }]);
    expect(run.end).toMatchObject({ status: 'completed', applied: 7 });
  });

  it('removes a folder its moves emptied, and keeps one that still holds something', async () => {
    const { vault, journal, executor } = applyHarness({ 'Old/Idea.md': 'idea', 'Busy/Kept.md': 'kept', 'Busy/Gone.md': 'gone' }, ['Old/Empty']);
    const plan = planOf([
      acceptedOp({ kind: 'removeEmptyFolder', path: 'Old/Empty' }),
      acceptedOp({ kind: 'removeEmptyFolder', path: 'Old' }),
      acceptedOp({ kind: 'removeEmptyFolder', path: 'Busy' }),
      acceptedOp({ kind: 'move', from: 'Old/Idea.md', to: 'Notes/Idea.md' }),
      acceptedOp({ kind: 'move', from: 'Busy/Gone.md', to: 'Notes/Gone.md' }),
    ]);

    const report = await executor.apply(plan, { runId: 'r' });

    // A folder that is not empty is kept, and the run goes on.
    expect(report).toMatchObject({ status: 'completed', applied: 4, skipped: 1 });
    expect(report.results.find((result) => result.status === 'skipped')).toMatchObject({ reason: 'Kept "Busy": something is still in it.' });
    expect(vault.folderPaths()).toEqual(['Busy', 'Notes']);
    const removals = (await journal.read('r')).ops.filter((op) => op.kind === 'removeEmptyFolder');
    expect(removals.map((op) => op.inverses)).toEqual([[{ type: 'recreateFolder', path: 'Old/Empty' }], [{ type: 'recreateFolder', path: 'Old' }]]);
  });

  it('records the notes whose links a move rewrote', async () => {
    const { journal, executor } = applyHarness({ 'A/Note.md': '', 'B/Other.md': '', 'Home.md': '[[Other]]' });
    await executor.apply(planOf([acceptedOp({ kind: 'move', from: 'B/Other.md', to: 'B/Note.md' })]), { runId: 'r' });
    const moveBack = (await journal.read('r')).ops[0]?.inverses.find((i) => i.type === 'moveBack');
    expect(moveBack).toMatchObject({
      from: 'B/Note.md',
      to: 'B/Other.md',
      sideEffects: [{ path: 'Home.md', beforeContent: '[[Other]]', afterHash: await sha256Hex('[[B/Note]]') }],
    });
  });

  it('skips operations whose precondition no longer holds, and their dependents', async () => {
    const { vault, executor } = applyHarness({ 'a.md': 'changed by the user' });
    const tags = acceptedOp({ kind: 'addTags', path: 'a.md', tags: ['x'] }, { precondition: { path: 'a.md', contentHash: 'old' } });
    const prop = acceptedOp({ kind: 'setProperty', path: 'a.md', key: 'k', value: 1 }, { dependsOn: [tags.id] });
    const report = await executor.apply(planOf([tags, prop]));
    expect(report.results).toEqual([
      { opId: tags.id, status: 'skipped', reason: '"a.md" changed since the plan was made.' },
      { opId: prop.id, status: 'skipped', reason: `Depends on ${tags.id}, which was not applied.` },
    ]);
    expect(await vault.read('a.md')).toBe('changed by the user');
  });

  it('skips operations that would change nothing', async () => {
    const { executor } = applyHarness({ 'a.md': '---\ntags: [x]\n---\n[[b]]', 'b.md': '' }, ['F']);
    const report = await executor.apply(
      planOf([
        acceptedOp({ kind: 'createFolder', path: 'F' }),
        acceptedOp({ kind: 'addTags', path: 'a.md', tags: ['X'] }),
        acceptedOp({ kind: 'addRelatedLinks', path: 'a.md', heading: '## Related', targets: ['b.md'] }),
      ]),
    );
    expect(report).toMatchObject({ status: 'completed', applied: 0, skipped: 3 });
  });

  it('only executes accepted operations', async () => {
    const { vault, executor } = applyHarness({ 'a.md': '' });
    const pending = createOperation({ kind: 'setProperty', path: 'a.md', key: 'k', value: 1 });
    const rejected = { ...pending, id: 'r', status: 'rejected' as const };
    const report = await executor.apply(planOf([pending, rejected]));
    expect(report.results).toEqual([]);
    expect(await vault.read('a.md')).toBe('');
  });

  it('stops at the first failure and journals what was applied', async () => {
    const { vault, journal, executor } = applyHarness({ 'a.md': '', 'b.md': '', 'c.md': '' });
    vault.failNextWriteTo = 'b.md';
    const report = await executor.apply(
      planOf([
        acceptedOp({ kind: 'setProperty', path: 'a.md', key: 'k', value: 1 }),
        acceptedOp({ kind: 'setProperty', path: 'b.md', key: 'k', value: 1 }),
        acceptedOp({ kind: 'setProperty', path: 'c.md', key: 'k', value: 1 }),
      ]),
      { runId: 'r' },
    );
    expect(report).toMatchObject({ status: 'failed', applied: 1, failed: 1 });
    expect(report.message).toContain('Simulated write failure');
    expect(await vault.read('c.md')).toBe('');
    expect((await journal.read('r')).end?.status).toBe('failed');
  });

  it('fails an update of a missing generated section without touching the note', async () => {
    const { vault, executor } = applyHarness({ 'n.md': 'no markers' });
    const report = await executor.apply(
      planOf([acceptedOp({ kind: 'updateGeneratedSection', path: 'n.md', sectionId: 'x', content: 'y' })]),
    );
    expect(report.status).toBe('failed');
    expect(await vault.read('n.md')).toBe('no markers');
  });

  it('stops after the current batch when cancelled or when verification fails', async () => {
    const ops = ['a', 'b', 'c', 'd'].map((n) => acceptedOp({ kind: 'createFolder', path: n }));
    const cancelled = applyHarness({});
    const signal = { aborted: false };
    const report = await cancelled.executor.apply(planOf(ops), {
      batchSize: 2,
      signal,
      afterBatch: async () => {
        signal.aborted = true;
        return { ok: true };
      },
    });
    expect(report).toMatchObject({ status: 'cancelled', applied: 2 });

    const verified = applyHarness({});
    const failing = await verified.executor.apply(planOf(ops), {
      batchSize: 2,
      afterBatch: async () => ({ ok: false, message: 'broken link' }),
    });
    expect(failing).toMatchObject({ status: 'verification-failed', applied: 2, message: 'broken link' });
  });

  it('reports progress', async () => {
    const { executor } = applyHarness({});
    const seen: string[] = [];
    await executor.apply(planOf([acceptedOp({ kind: 'createFolder', path: 'a' }), acceptedOp({ kind: 'createFolder', path: 'b' })]), {
      onProgress: ({ done, total }) => seen.push(`${done}/${total}`),
    });
    expect(seen).toEqual(['0/2', '1/2', '2/2']);
  });
});
