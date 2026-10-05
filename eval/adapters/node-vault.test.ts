import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeFsVault } from './node-vault';

const tinyRoot = path.resolve(import.meta.dirname, '../../fixtures/vaults/tiny');

describe('NodeFsVault on the tiny fixture', () => {
  const vault = new NodeFsVault(tinyRoot, { clock: { now: () => 0 } });

  it('lists notes, folders and other files, skipping hidden ones', async () => {
    const snapshot = await vault.snapshot();
    expect(snapshot.notes.map((n) => n.path)).toEqual([
      'Areas/Zdraví/Spánek.md',
      'Broken frontmatter.md',
      'Daily/2026-10-01.md',
      'Home.md',
      'Orphan stub.md',
      'Projects/Website/Hosting options.md',
      'Projects/Website/Website plan.md',
      'README.md',
      'Resources/Pasta carbonara.md',
    ]);
    expect(snapshot.folders).toEqual([
      'Areas',
      'Areas/Zdraví',
      'Attachments',
      'Daily',
      'Empty folder',
      'Projects',
      'Projects/Website',
      'Resources',
    ]);
    expect(snapshot.otherFiles.map((f) => f.path)).toEqual(['Attachments/pixel.png', 'Canvas board.canvas']);
  });

  it('parses frontmatter, tags, headings and links of the hub note', async () => {
    const home = (await vault.snapshot()).notes.find((n) => n.path === 'Home.md');
    expect(home).toMatchObject({
      basename: 'Home',
      folder: '',
      frontmatter: { tags: ['hub', 'Overview'], aliases: ['Start'], created: '2026-01-15' },
      tags: ['hub', 'Overview', 'inline-tag'],
      headings: [{ level: 1, text: 'Home' }],
      outLinks: ['Areas/Zdraví/Spánek.md', 'Projects/Website/Website plan.md', 'Resources/Pasta carbonara.md'],
      unresolvedLinks: ['Someday note'],
      inLinks: ['Projects/Website/Website plan.md'],
    });
  });

  it('resolves relative Markdown links and frontmatter links', async () => {
    const notes = (await vault.snapshot()).notes;
    const hosting = notes.find((n) => n.basename === 'Hosting options');
    const plan = notes.find((n) => n.basename === 'Website plan');
    expect(hosting?.outLinks).toEqual(['Projects/Website/Website plan.md']);
    expect(plan?.unresolvedLinks).toEqual(['Projects']);
    expect(plan?.outLinks).toEqual(['Daily/2026-10-01.md', 'Home.md', 'Projects/Website/Hosting options.md']);
  });

  it('treats invalid frontmatter as empty and still parses the body', async () => {
    const broken = (await vault.snapshot()).notes.find((n) => n.basename === 'Broken frontmatter');
    expect(broken?.frontmatter).toEqual({});
    expect(broken?.wordCount).toBe(5);
  });

  it('reads raw content and checks existence', async () => {
    expect(await vault.read('Orphan stub.md')).toBe('Just a fragment\n');
    expect(await vault.exists('Empty folder')).toBe(true);
    expect(await vault.exists('Nope.md')).toBe(false);
  });
});
