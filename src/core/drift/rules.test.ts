import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets/index';
import { type Charter, charterSchema } from '../charter/schema';
import { InMemoryVault } from '../testing/in-memory-vault';
import { dateFormatRegExp, RuleEngine } from './rules';

async function notesOf(files: Record<string, string>) {
  const snapshot = await InMemoryVault.from(files).snapshot();
  return new Map(snapshot.notes.map((note) => [note.path, note]));
}

async function evaluate(charter: Charter, files: Record<string, string>, charterPath: string | null = null) {
  const engine = new RuleEngine(charter, charterPath);
  const notes = await notesOf(files);
  return Object.fromEntries([...notes].map(([path, note]) => [path, engine.evaluate(note)]));
}

describe('RuleEngine with the PARA preset', () => {
  const charter = presetCharter('para', 'en');

  it('places notes by rules, location, inbox, system folders and ignores', async () => {
    const result = await evaluate(
      charter,
      {
        'Vault Charter.md': '---\ncharter: true\n---\n',
        'Plan.md': '---\ntype: project\n---\n',
        '1 Projects/Site/Site.md': '---\ntype: project\n---\n',
        '2 Areas/Health/Done project.md': '---\ntype: project\nstatus: done\n---\n',
        '3 Resources/Cooking/Pasta.md': 'no properties',
        '0 Inbox/Idea.md': '',
        'Loose.md': '',
        'Elsewhere/2026-10-05.md': '',
        'Daily/2026-10-04.md': '',
        'Templates/Project.md': '---\ntype: project\n---\n',
      },
      'Vault Charter.md',
    );

    expect(result['Vault Charter.md']).toEqual({ status: 'charter' });
    expect(result['Templates/Project.md']).toEqual({ status: 'ignored' });
    expect(result['Plan.md']).toMatchObject({
      status: 'ruled',
      destination: { id: 'projects' },
      rule: 'type: project',
      expectation: { folder: '1 Projects/Plan', path: '1 Projects/Plan/Plan.md', inPlace: false },
    });
    expect(result['1 Projects/Site/Site.md']).toMatchObject({ status: 'ruled', expectation: { inPlace: true } });
    expect(result['2 Areas/Health/Done project.md']).toMatchObject({
      status: 'ruled',
      destination: { id: 'archive' },
      expectation: { path: '4 Archive/Done project.md' },
    });
    expect(result['3 Resources/Cooking/Pasta.md']).toMatchObject({ status: 'placed', destination: { id: 'resources' } });
    expect(result['0 Inbox/Idea.md']).toEqual({ status: 'inbox' });
    expect(result['Loose.md']).toEqual({ status: 'unplaced' });
    expect(result['Elsewhere/2026-10-05.md']).toMatchObject({ status: 'system', role: 'daily', expectation: { path: 'Daily/2026-10-05.md' } });
    expect(result['Daily/2026-10-04.md']).toMatchObject({ status: 'system', expectation: { inPlace: true } });
  });

  it('ignores property case and accepts any listed value', async () => {
    const result = await evaluate(charter, { 'a.md': '---\nType: Project\n---\n', 'b.md': '---\nstatus: [active, archived]\n---\n' });
    expect(result['a.md']).toMatchObject({ status: 'ruled', destination: { id: 'projects' } });
    expect(result['b.md']).toMatchObject({ status: 'ruled', destination: { id: 'archive' } });
  });
});

describe('rule kinds', () => {
  const charter = charterSchema.parse({
    version: 1,
    preset: 'custom',
    destinations: [
      { id: 'tagged', path: 'Tagged', match: [{ tag: '#Project' }] },
      { id: 'clips', path: 'Clips', match: [{ property: 'source', exists: true }] },
      { id: 'ids', path: 'Ids', match: [{ filename: '^\\d{12}' }] },
      { id: 'globbed', path: 'Globbed', match: [{ pathGlob: 'Old/**' }] },
      { id: 'nested', path: 'Tagged/Inner' },
    ],
  });

  it('matches tags (with nesting), existing properties, file names and globs', async () => {
    const result = await evaluate(charter, {
      'a.md': '#project/web',
      'b.md': '---\nsource: https://example.com\n---\n',
      'c.md': '---\nsource: ""\n---\n',
      '202601011200 Idea.md': '',
      'Old/x.md': '',
      'Tagged/Inner/y.md': '',
    });
    expect(result['a.md']).toMatchObject({ destination: { id: 'tagged' } });
    expect(result['b.md']).toMatchObject({ destination: { id: 'clips' } });
    expect(result['c.md']).toEqual({ status: 'unplaced' });
    expect(result['202601011200 Idea.md']).toMatchObject({ destination: { id: 'ids' } });
    expect(result['Old/x.md']).toMatchObject({ destination: { id: 'globbed' } });
    expect(result['Tagged/Inner/y.md']).toMatchObject({ status: 'placed', destination: { id: 'nested' } });
  });
});

describe('properties mode', () => {
  it('treats the root as home and checks categories', async () => {
    const charter = charterSchema.parse({
      ...presetCharter('flat-categories', 'en'),
      destinations: [
        ...presetCharter('flat-categories', 'en').destinations,
        { id: 'recipes', category: '[[Recipes]]', match: [{ property: 'type', equals: 'recipe' }] },
      ],
    });
    const result = await evaluate(charter, {
      'Note.md': '',
      'Dune.md': '---\ntype: recipe\ncategories: ["[[Recipes]]"]\n---\n',
      'Hobbit.md': '---\ntype: recipe\n---\n',
      'Article.md': '---\nsource: https://example.com\n---\n',
    });
    expect(result['Note.md']).toEqual({ status: 'placed', destination: null });
    expect(result['Dune.md']).toMatchObject({ status: 'ruled', expectation: { inPlace: true, category: '[[Recipes]]', path: null } });
    expect(result['Hobbit.md']).toMatchObject({ status: 'ruled', expectation: { inPlace: false, category: '[[Recipes]]' } });
    expect(result['Article.md']).toMatchObject({ status: 'ruled', expectation: { path: 'Clippings/Article.md' } });
  });
});

describe('dateFormatRegExp', () => {
  it.each([
    ['YYYY-MM-DD', '2026-10-05', true],
    ['YYYY-MM-DD', '2026-10-05 Meeting', false],
    ['YYYYMMDD', '20261005', true],
    ['gggg-[W]ww', 'x', false],
    ['YYYY-[W]ww', '2026-W41', true],
    ['DD. MM. YYYY', '05. 10. 2026', true],
  ])('%s matches %s → %s', (format, name, expected) => {
    expect(dateFormatRegExp(format).test(name)).toBe(expected);
  });
});
