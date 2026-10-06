import { describe, expect, it } from 'vitest';
import { ApplyRunService } from '../apply/run';
import { UndoService } from '../apply/undo';
import { presetCharter } from '../charter/presets';
import type { Charter } from '../charter/schema';
import { primaryPath } from '../model/operation';
import { createPlan } from '../model/plan';
import { applyHarness } from '../testing/apply-harness';
import { kebabTag, propertyOperations, tagOperations } from './normalize';

const charter: Charter = {
  ...presetCharter('para', 'en'),
  conventions: {
    properties: { required: ['type', 'created'], enums: { type: ['project', 'area', 'resource', 'note'] } },
    tags: { style: 'lowercase-kebab', nested: true, canonical: { gtd: 'productivity' } },
    links: { relatedHeading: '## Related' },
  },
};

const files = {
  'a.md': '---\nType: Project\nStatus: active\ncreated: 2026-01-01\n---\nA. #Web_Dev',
  'b.md': '---\nkind: note\ntype: area\ncreated: 2026-01-02\ntags: [web-dev, GTD]\n---\nB.',
  'c.md': '---\ntype: Area\ntags: [Garden/Vegetables]\n---\nC. #web-dev',
};

describe('propertyOperations', () => {
  it('renames misspelled keys without clobbering, fixes enum case, fills a required created date', async () => {
    const { vault } = applyHarness(files);
    const notes = (await vault.snapshot()).notes;
    const operations = propertyOperations(notes, charter);
    const summary = operations.map((op) => (op.kind === 'renameProperty' ? `${op.path}: ${op.from} → ${op.to}` : op.kind === 'setProperty' ? `${op.path}: ${op.key} = ${JSON.stringify(op.value)}` : op.kind));
    expect(summary).toEqual([
      'a.md: Type → type',
      'a.md: Status → status',
      'a.md: type = "project"',
      // "kind" would collide with the existing "type", so b.md is left alone.
      'c.md: type = "area"',
      expect.stringMatching(/^c\.md: created = "\d{4}-\d{2}-\d{2}"$/),
    ]);
    const fix = operations.find((op) => op.kind === 'setProperty' && op.path === 'a.md');
    expect(fix?.dependsOn).toEqual([operations[0]?.id]);
  });

  it('applies through the executor, keeps key order, and undoes exactly', async () => {
    const { vault, deps, storage, clock } = applyHarness(files);
    const original = vault.contents();
    const operations = propertyOperations((await vault.snapshot()).notes, charter).filter((op) => primaryPath(op) === 'a.md');
    const plan = createPlan({ id: 'props', createdAt: '2026-10-07T00:00:00.000Z', operations: operations.map((op) => ({ ...op, status: 'accepted' as const })) });
    const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'test' });
    expect(outcome.kind === 'ran' && outcome.report).toMatchObject({ status: 'completed', applied: 3, failed: 0 });
    expect(await vault.read('a.md')).toBe('---\ntype: project\nstatus: active\ncreated: 2026-01-01\n---\nA. #Web_Dev');
    await new UndoService(deps).undoLast();
    expect(vault.contents()).toEqual(original);
  });

  it('never overwrites an existing key when renaming', async () => {
    const { vault, deps, storage, clock } = applyHarness({ 'x.md': '---\nType: a\n---\nX.' });
    const [rename] = propertyOperations((await vault.snapshot()).notes, charter);
    if (!rename) throw new Error('expected a rename');
    vault.setFile('x.md', '---\nType: a\ntype: b\n---\nX.');
    const plan = createPlan({ id: 'clash', createdAt: '2026-10-07T00:00:00.000Z', operations: [{ ...rename, status: 'accepted', precondition: undefined }] });
    const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'test' });
    expect(outcome.kind === 'ran' && outcome.report.failed).toBe(1);
    expect(await vault.read('x.md')).toBe('---\nType: a\ntype: b\n---\nX.');
  });
});

describe('tagOperations', () => {
  it('merges spellings, applies the canonical map and the kebab style, in text and properties', async () => {
    const { vault, deps, storage, clock } = applyHarness(files);
    const operations = tagOperations((await vault.snapshot()).notes, charter);
    expect(operations.map((op) => (op.kind === 'replaceTag' ? `${op.path}: #${op.from} → #${op.to}` : op.kind))).toEqual([
      'a.md: #Web_Dev → #web-dev',
      'b.md: #GTD → #productivity',
      'c.md: #Garden/Vegetables → #garden/vegetables',
    ]);
    const plan = createPlan({ id: 'tags', createdAt: '2026-10-07T00:00:00.000Z', operations: operations.map((op) => ({ ...op, status: 'accepted' as const })) });
    await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'test' });
    expect(await vault.read('a.md')).toContain('#web-dev');
    // Rewritten frontmatter uses block lists, as Obsidian's processFrontMatter does.
    expect(await vault.read('b.md')).toContain('tags:\n  - web-dev\n  - productivity');
  });

  it('keeps tags as they are with the keep style unless spellings differ', async () => {
    const { vault } = applyHarness({ 'a.md': '#Project', 'b.md': '#project', 'c.md': '#project', 'd.md': '#Unique' });
    const keep: Charter = { ...charter, conventions: { ...charter.conventions, tags: { style: 'keep', nested: true } } };
    expect(tagOperations((await vault.snapshot()).notes, keep).map((op) => (op.kind === 'replaceTag' ? op.path : op.kind))).toEqual(['a.md']);
  });
});

describe('kebabTag', () => {
  it('lowercases and hyphenates each segment', () => {
    expect(kebabTag('Project Management/Q4_Plans')).toBe('project-management/q4-plans');
    expect(kebabTag('Vaření')).toBe('vaření');
  });
});
