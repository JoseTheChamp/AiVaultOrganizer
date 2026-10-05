import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { acceptedOp, applyHarness, planOf } from '../testing/apply-harness';
import { UndoService } from './undo';
import { LinkVerifier } from './verify';

async function applyVerified(harness: ReturnType<typeof applyHarness>, ops: Parameters<typeof planOf>[0]) {
  const verifier = new LinkVerifier(harness.vault);
  await verifier.captureBaseline();
  return harness.executor.apply(planOf(ops), { afterBatch: ({ moves }) => verifier.check(moves) });
}

describe('LinkVerifier', () => {
  it('passes when moved notes keep all their links', async () => {
    const harness = applyHarness({ 'Home.md': '[[Inbox/Idea]] ![[pic.png]]', 'Inbox/Idea.md': '[[Home]]', 'pic.png': 'x' });
    const report = await applyVerified(harness, [
      acceptedOp({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/Idea.md' }),
      acceptedOp({ kind: 'move', from: 'Home.md', to: 'Maps/Home.md' }),
    ]);
    expect(report.status).toBe('completed');
  });

  it('stops the run when links are not updated on move', async () => {
    const harness = applyHarness({ 'Home.md': '[[Inbox/Idea]]', 'Inbox/Idea.md': '' });
    harness.vault.updateLinksOnMove = false;
    const report = await applyVerified(harness, [acceptedOp({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/Idea.md' })]);
    expect(report.status).toBe('verification-failed');
    expect(report.message).toBe(
      'Link verification failed: 1 existing link no longer resolves (e.g. "Home.md" → "Projects/Idea.md"); 1 new unresolved link.',
    );
  });

  it('catches generated notes with broken links', async () => {
    const harness = applyHarness({ 'a.md': '' });
    const report = await applyVerified(harness, [
      acceptedOp({ kind: 'createNote', path: 'MOC.md', role: 'moc', content: '[[a]] [[Nope]]' }),
    ]);
    expect(report).toMatchObject({ status: 'verification-failed', message: 'Link verification failed: 1 new unresolved link.' });
  });

  it('catches a move that redirects an existing link to another note', async () => {
    const harness = applyHarness({ 'A/B/Alpha.md': '', 'C/Alpha.md': '', 'C/Home.md': '[[Alpha]]' });
    const verifier = new LinkVerifier(harness.vault);
    await verifier.captureBaseline();
    await harness.executor.apply(planOf([acceptedOp({ kind: 'move', from: 'A/B/Alpha.md', to: 'Alpha.md' })]));
    const result = await verifier.check(new Map([['A/B/Alpha.md', 'Alpha.md']]));
    expect(result.brokenLinks).toEqual([{ source: 'C/Home.md', target: 'C/Alpha.md' }]);
  });

  it('requires a baseline', async () => {
    await expect(new LinkVerifier(applyHarness({}).vault).check(new Map())).rejects.toThrow('captureBaseline');
  });

  it('leaves every run undoable, whether it completed or stopped on verification', async () => {
    const names = ['Alpha', 'Beta', 'Gamma'];
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.constantFrom('', 'A', 'B'), fc.constantFrom(...names), fc.constantFrom(...names)), {
          minLength: 2,
          maxLength: 5,
        }),
        fc.constantFrom('', 'A', 'B', 'New'),
        fc.boolean(),
        async (specs, targetFolder, updateLinks) => {
          const files: Record<string, string> = {};
          for (const [folder, name, link] of specs) files[`${folder ? `${folder}/` : ''}${name}.md`] = `[[${link}]]`;
          const harness = applyHarness(files);
          harness.vault.updateLinksOnMove = updateLinks;
          const [first] = Object.keys(files);
          const to = `${targetFolder ? `${targetFolder}/` : ''}Moved.md`;
          fc.pre(first !== undefined && !(to in files));
          const before = harness.vault.contents();

          const report = await applyVerified(harness, [acceptedOp({ kind: 'move', from: first ?? '', to })]);
          expect(['completed', 'verification-failed']).toContain(report.status);
          harness.vault.updateLinksOnMove = updateLinks;
          await new UndoService(harness.deps).undoLast();
          expect(harness.vault.contents()).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
