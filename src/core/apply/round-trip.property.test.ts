/**
 * Property-based tests of the safety layer (PLAN §10): for random valid plans on random vaults,
 * apply followed by undo must reproduce the original vault byte for byte, and the validator must
 * reject every generated collision.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Operation } from '../model/operation';
import { baseName, joinPath } from '../model/paths';
import { acceptedOp, applyHarness, planOf } from '../testing/apply-harness';
import { UndoService } from './undo';
import { validatePlan } from './validate';

const NAMES = ['Alpha', 'Beta', 'Plan', 'Notes', 'Žluťoučký kůň'];
const FOLDERS = ['', 'A', 'A/B', 'C'];
const TARGET_FOLDERS = ['', 'A', 'New', 'New/Deep', 'C'];
const TAGS = ['x', 'Y', 'proj/web', 'Proj'];

const noteArb = fc.record({
  folder: fc.constantFrom(...FOLDERS),
  name: fc.constantFrom(...NAMES),
  frontmatter: fc.option(
    fc.record({ type: fc.constantFrom('a', 'b'), tags: fc.subarray(TAGS), comment: fc.boolean() }),
    { nil: undefined },
  ),
  links: fc.array(fc.record({ target: fc.nat(20), form: fc.constantFrom('name', 'path', 'alias', 'markdown', 'heading') }), {
    maxLength: 4,
  }),
  inlineTags: fc.subarray(TAGS),
  code: fc.boolean(),
});

const vaultArb = fc.uniqueArray(noteArb, {
  selector: (note) => joinPath(note.folder, note.name).toLowerCase(),
  minLength: 2,
  maxLength: 7,
});

const seedArb = fc.record({
  kind: fc.constantFrom('move', 'setProperty', 'addTags', 'replaceTag', 'addRelatedLinks', 'createNote', 'createFolder'),
  a: fc.nat(50),
  b: fc.nat(50),
  c: fc.nat(50),
});

type NoteSpec = fc.Arbitrary<typeof noteArb extends fc.Arbitrary<infer T> ? T : never> extends fc.Arbitrary<infer U> ? U : never;

function render(notes: NoteSpec[]): Record<string, string> {
  const paths = notes.map((note) => `${joinPath(note.folder, note.name)}.md`);
  const files: Record<string, string> = {};
  notes.forEach((note, index) => {
    const lines: string[] = [];
    if (note.frontmatter) {
      lines.push('---', `type: ${note.frontmatter.type}${note.frontmatter.comment ? '  # kept' : ''}`);
      if (note.frontmatter.tags.length > 0) lines.push(`tags: [${note.frontmatter.tags.join(', ')}]`);
      lines.push('---');
    }
    lines.push(`# ${note.name}`);
    for (const link of note.links) {
      const target = paths[link.target % paths.length] ?? '';
      const name = baseName(target);
      const withoutExt = target.slice(0, -3);
      if (link.form === 'name') lines.push(`See [[${name}]].`);
      if (link.form === 'path') lines.push(`See [[${withoutExt}]].`);
      if (link.form === 'alias') lines.push(`See [[${withoutExt}|that note]].`);
      if (link.form === 'heading') lines.push(`See [[${name}#Part]].`);
      if (link.form === 'markdown') lines.push(`See [it](${encodeURI(target)}).`);
    }
    lines.push(note.inlineTags.map((tag) => `#${tag}`).join(' '));
    if (note.code) lines.push('```', '[[Alpha]] #x', '```');
    files[paths[index] ?? ''] = `${lines.join('\n')}\n`;
  });
  return files;
}

/** Turns random seeds into a plan against the vault: moves first, then edits on final paths. */
function buildPlan(paths: string[], seeds: { kind: string; a: number; b: number; c: number }[]): Operation[] {
  const current = [...paths];
  const moved = new Set<number>();
  const ops: Operation[] = [];
  for (const seed of seeds.filter((s) => s.kind === 'move')) {
    const index = seed.a % paths.length;
    if (moved.has(index)) continue;
    moved.add(index);
    const name = seed.c % 3 === 0 ? (NAMES[seed.c % NAMES.length] ?? 'X') : baseName(current[index] ?? '');
    const to = `${joinPath(TARGET_FOLDERS[seed.b % TARGET_FOLDERS.length] ?? '', name)}.md`;
    ops.push(acceptedOp({ kind: 'move', from: current[index] ?? '', to }));
    current[index] = to;
  }
  for (const seed of seeds.filter((s) => s.kind !== 'move')) {
    const path = current[seed.a % current.length] ?? '';
    const other = current[seed.b % current.length] ?? '';
    switch (seed.kind) {
      case 'setProperty':
        ops.push(acceptedOp({ kind: 'setProperty', path, key: seed.b % 2 ? 'status' : 'type', value: seed.c % 2 ? 'done' : ['x', seed.c] }));
        break;
      case 'addTags':
        ops.push(acceptedOp({ kind: 'addTags', path, tags: [TAGS[seed.b % TAGS.length] ?? 'x', `t${seed.c % 3}`] }));
        break;
      case 'replaceTag':
        ops.push(acceptedOp({ kind: 'replaceTag', path, from: TAGS[seed.b % TAGS.length] ?? 'x', to: `renamed-${seed.c % 2}` }));
        break;
      case 'addRelatedLinks':
        if (other !== path) ops.push(acceptedOp({ kind: 'addRelatedLinks', path, heading: '## Related', targets: [other] }));
        break;
      case 'createNote':
        ops.push(
          acceptedOp({
            kind: 'createNote',
            path: `${joinPath(TARGET_FOLDERS[seed.a % TARGET_FOLDERS.length] ?? '', `MOC ${seed.b % 4}`)}.md`,
            role: 'moc',
            content: `# MOC\n- [[${baseName(other)}]]\n`,
          }),
        );
        break;
      case 'createFolder':
        ops.push(acceptedOp({ kind: 'createFolder', path: joinPath(TARGET_FOLDERS[seed.a % TARGET_FOLDERS.length] ?? '', `Extra ${seed.b % 3}`) }));
        break;
    }
  }
  return [...new Map(ops.map((op) => [op.id, op])).values()];
}

describe('apply → undo round trip', () => {
  it('restores every random vault byte for byte after any valid plan', async () => {
    await fc.assert(
      fc.asyncProperty(vaultArb, fc.array(seedArb, { maxLength: 10 }), async (notes, seeds) => {
        const files = render(notes);
        const { vault, executor, deps } = applyHarness(files, ['Empty']);
        const operations = buildPlan(Object.keys(files), seeds);
        const plan = planOf(operations);
        const validation = validatePlan(plan, { snapshot: await vault.snapshot() });
        fc.pre(validation.ok);

        const before = vault.contents();
        const folders = vault.folderPaths();
        const report = await executor.apply(plan);
        expect(report.status).toBe('completed');

        await new UndoService(deps).undoLast();
        expect(vault.contents()).toEqual(before);
        expect(vault.folderPaths()).toEqual(folders);
      }),
      // FC_RUNS=5000 npm test -- round-trip   for a longer local hunt.
      { numRuns: Number(process.env.FC_RUNS ?? 150) },
    );
  }, 600_000);
});

describe('validator', () => {
  it('rejects any two moves into the same path, in any casing', async () => {
    await fc.assert(
      fc.asyncProperty(vaultArb, fc.nat(), fc.nat(), fc.boolean(), async (notes, i, j, upper) => {
        const files = render(notes);
        const paths = Object.keys(files);
        const a = paths[i % paths.length] ?? '';
        const b = paths[(i + 1 + (j % (paths.length - 1))) % paths.length] ?? '';
        fc.pre(a !== b);
        const target = 'Target/Same.md';
        const { vault } = applyHarness(files);
        const plan = planOf([
          acceptedOp({ kind: 'move', from: a, to: target }),
          acceptedOp({ kind: 'move', from: b, to: upper ? target.toUpperCase() : target }),
        ]);
        expect(validatePlan(plan, { snapshot: await vault.snapshot() }).ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any move onto an existing note', async () => {
    await fc.assert(
      fc.asyncProperty(vaultArb, fc.nat(), fc.nat(), async (notes, i, j) => {
        const files = render(notes);
        const paths = Object.keys(files);
        const from = paths[i % paths.length] ?? '';
        const onto = paths[j % paths.length] ?? '';
        fc.pre(from.toLowerCase() !== onto.toLowerCase());
        const { vault } = applyHarness(files);
        const plan = planOf([acceptedOp({ kind: 'move', from, to: onto })]);
        expect(validatePlan(plan, { snapshot: await vault.snapshot() }).issues.map((x) => x.code)).toContain('target-exists');
      }),
      { numRuns: 100 },
    );
  });
});
