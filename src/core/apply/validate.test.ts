import { describe, expect, it } from 'vitest';
import { createOperation, type Operation, type OperationIntent } from '../model/operation';
import { createPlan } from '../model/plan';
import { InMemoryVault } from '../testing/in-memory-vault';
import { orderOperations } from './order';
import { type ValidationContext, validatePlan } from './validate';

const accepted = (intent: OperationIntent, extra: Partial<Operation> = {}): Operation =>
  ({ ...createOperation(intent, { status: 'accepted' }), ...extra }) as Operation;

async function context(overrides: Partial<ValidationContext> = {}): Promise<ValidationContext> {
  const vault = InMemoryVault.from({
    'Inbox/Idea.md': 'idea',
    'Inbox/Plan.md': 'plan',
    'Projects/Site/Site.md': 'site',
    'Templates/T.md': 't',
    'pic.png': 'binary',
  });
  return { snapshot: await vault.snapshot(), ...overrides };
}

function codes(plan: Operation[], ctx: ValidationContext) {
  return validatePlan(createPlan({ id: 'p', createdAt: 'now', operations: plan }), ctx).issues.map((i) => i.code);
}

describe('validatePlan', () => {
  it('accepts a coherent plan', async () => {
    const ops = [
      accepted({ kind: 'createFolder', path: 'Projects/New' }),
      accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'Projects/New/Idea.md' }),
      accepted({ kind: 'setProperty', path: 'Projects/New/Idea.md', key: 'type', value: 'project' }),
      accepted({ kind: 'addRelatedLinks', path: 'Projects/New/Idea.md', heading: '## Related', targets: ['Projects/Site/Site.md'] }),
      accepted({ kind: 'createNote', path: 'Projects/New/New.md', role: 'moc', content: '# New' }),
    ];
    const report = validatePlan(createPlan({ id: 'p', createdAt: 'now', operations: ops }), await context());
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('only validates accepted operations by default', async () => {
    const pending = createOperation({ kind: 'move', from: 'Nope.md', to: 'X.md' });
    expect(codes([pending], await context())).toEqual([]);
  });

  it('detects collisions with existing files and between moves, case-insensitively', async () => {
    const ctx = await context();
    expect(codes([accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'inbox/plan.md' })], ctx)).toEqual(['target-exists']);
    expect(
      codes(
        [
          accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'Archive/Note.md' }),
          accepted({ kind: 'move', from: 'Inbox/Plan.md', to: 'Archive/note.md' }),
        ],
        ctx,
      ),
    ).toEqual(['target-exists']);
    expect(codes([accepted({ kind: 'createNote', path: 'Inbox/Idea.md', role: 'moc', content: '' })], ctx)).toEqual([
      'target-exists',
    ]);
  });

  it('allows moving into a path vacated earlier and changing only the case', async () => {
    const ctx = await context();
    expect(
      codes(
        [
          accepted({ kind: 'move', from: 'Inbox/Plan.md', to: 'Archive/Plan.md' }),
          accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'Inbox/Plan.md' }),
        ],
        ctx,
      ),
    ).toEqual([]);
    expect(codes([accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'Inbox/idea.md' })], ctx)).toEqual([]);
  });

  it('rejects missing sources, double moves and references to pre-move paths', async () => {
    const ctx = await context();
    expect(codes([accepted({ kind: 'move', from: 'Gone.md', to: 'X.md' })], ctx)).toEqual(['missing-source']);
    expect(
      codes(
        [
          accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'A/Idea.md' }),
          accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'B/Idea.md' }),
        ],
        ctx,
      ),
    ).toEqual(['moved-twice']);
    const report = validatePlan(
      createPlan({
        id: 'p',
        createdAt: 'now',
        operations: [
          accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'A/Idea.md' }),
          accepted({ kind: 'addTags', path: 'Inbox/Idea.md', tags: ['x'] }),
        ],
      }),
      ctx,
    );
    expect(report.issues[0]?.message).toContain('refer to "A/Idea.md"');
  });

  it('protects hidden, plugin and ignored paths and enforces destinations', async () => {
    const ctx = await context({ ignore: ['Templates/**'], allowedRoots: ['Projects', 'Archive'] });
    expect(codes([accepted({ kind: 'setProperty', path: '.obsidian/app.md', key: 'a', value: 1 })], ctx)).toContain(
      'protected-path',
    );
    expect(codes([accepted({ kind: 'createNote', path: '.ai-vault-organizer/x.md', role: 'moc', content: '' })], ctx)).toContain(
      'protected-path',
    );
    expect(codes([accepted({ kind: 'move', from: 'Templates/T.md', to: 'Projects/T.md' })], ctx)).toEqual(['ignored-path']);
    expect(codes([accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'Elsewhere/Idea.md' })], ctx)).toEqual([
      'outside-destinations',
    ]);
  });

  it("removes a folder only when the plan leaves it empty, and never the charter's own", async () => {
    const ctx = await context({ allowedRoots: ['Projects', 'Archive'] });
    const moveOut = (name: string) => accepted({ kind: 'move', from: `Inbox/${name}.md`, to: `Projects/${name}.md` });
    expect(codes([moveOut('Idea'), moveOut('Plan'), accepted({ kind: 'removeEmptyFolder', path: 'Inbox' })], ctx)).toEqual([]);
    // One note stays: the review says the folder will be kept.
    expect(codes([moveOut('Idea'), accepted({ kind: 'removeEmptyFolder', path: 'Inbox' })], ctx)).toEqual(['folder-not-empty']);
    expect(codes([accepted({ kind: 'removeEmptyFolder', path: 'Projects' })], ctx)).toContain('charter-folder');
    expect(codes([accepted({ kind: 'removeEmptyFolder', path: 'Nowhere' })], ctx)).toEqual(['missing-source']);
  });

  it('rejects malformed paths, non-Markdown moves and no-op moves', async () => {
    const ctx = await context();
    expect(codes([accepted({ kind: 'move', from: 'Inbox/Idea.md', to: '../outside.md' })], ctx)).toContain('invalid-path');
    expect(codes([accepted({ kind: 'move', from: 'pic.png', to: 'Attachments/pic.png' })], ctx)).toContain('not-markdown');
    expect(codes([accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'Inbox/Idea.md' })], ctx)).toContain('no-op');
  });

  it('checks dependencies for unknown ids, cycles and phase order', async () => {
    const ctx = await context();
    const folder = accepted({ kind: 'createFolder', path: 'A' });
    const move = accepted({ kind: 'move', from: 'Inbox/Idea.md', to: 'A/Idea.md' }, { dependsOn: [folder.id] });
    expect(codes([folder, move], ctx)).toEqual([]);
    const backwards = accepted({ kind: 'createFolder', path: 'B' }, { dependsOn: [move.id] });
    expect(codes([folder, move, backwards], ctx)).toContain('dependency-order');
    expect(codes([accepted({ kind: 'createFolder', path: 'C' }, { dependsOn: ['nope'] })], ctx)).toEqual([
      'unknown-dependency',
    ]);
    const a = accepted({ kind: 'createFolder', path: 'D' }, { id: 'a', dependsOn: ['b'] });
    const b = accepted({ kind: 'createFolder', path: 'E' }, { id: 'b', dependsOn: ['a'] });
    expect(codes([a, b], ctx)).toContain('dependency-cycle');
  });

  it('warns about stale preconditions and existing folders without blocking', async () => {
    const ctx = await context();
    const report = validatePlan(
      createPlan({
        id: 'p',
        createdAt: 'now',
        operations: [
          accepted({ kind: 'addTags', path: 'Inbox/Idea.md', tags: ['x'] }, { precondition: { path: 'Inbox/Idea.md', contentHash: 'old' } }),
          accepted({ kind: 'createFolder', path: 'Inbox' }),
        ],
      }),
      ctx,
    );
    expect(report.ok).toBe(true);
    expect(report.issues.map((i) => [i.code, i.severity])).toEqual([
      ['stale-precondition', 'warning'],
      ['folder-exists', 'warning'],
    ]);
    expect(report.staleOpIds).toHaveLength(1);
  });

  it('requires link targets to exist and duplicate ids to be unique', async () => {
    const ctx = await context();
    expect(
      codes([accepted({ kind: 'addRelatedLinks', path: 'Inbox/Idea.md', heading: '## Related', targets: ['Nope.md'] })], ctx),
    ).toEqual(['missing-link-target']);
    const op = accepted({ kind: 'createFolder', path: 'Z' });
    expect(codes([op, op], ctx)).toContain('duplicate-id');
  });
});

describe('orderOperations', () => {
  it('orders by phase, then dependencies, then plan position', () => {
    const tags = createOperation({ kind: 'addTags', path: 'a.md', tags: ['x'] });
    const folder = createOperation({ kind: 'createFolder', path: 'F' });
    const move2 = createOperation({ kind: 'move', from: 'b.md', to: 'F/b.md' });
    const move1 = { ...createOperation({ kind: 'move', from: 'a.md', to: 'F/a.md' }), dependsOn: [move2.id] };
    expect(orderOperations([tags, move1, folder, move2]).map((op) => op.kind + ':' + ('from' in op ? op.from : op.path))).toEqual([
      'createFolder:F',
      'move:b.md',
      'move:a.md',
      'addTags:a.md',
    ]);
  });
});
