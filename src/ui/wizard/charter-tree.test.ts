import { describe, expect, it } from 'vitest';
import { presetCharter } from '../../core/charter/presets/index';
import { InMemoryVault } from '../../core/testing/in-memory-vault';
import { charterFit } from './charter-tree';

async function snapshot(files: Record<string, string>) {
  return InMemoryVault.from(files).snapshot();
}

describe('charterFit', () => {
  it('shows PARA as top folders with the notes its rules place, and counts what stays open', async () => {
    const fit = charterFit(
      presetCharter('para', 'en'),
      await snapshot({
        '1 Projects/Website/Website.md': '---\ntype: project\n---\n',
        '1 Projects/Thesis/Plan.md': 'Plan.',
        'Old.md': '---\nstatus: done\n---\n',
        '2026-10-01.md': 'Daily.',
        'Loose.md': 'Something.',
        '0 Inbox/Idea.md': 'Idea.',
        'Templates/Day.md': 'Template.',
      }),
      null,
    );
    expect(fit.tree.map((node) => [node.name, node.notes])).toEqual([
      ['0 Inbox', 1],
      ['1 Projects', 2],
      ['2 Areas', 0],
      ['3 Resources', 0],
      ['4 Archive', 1],
      ['Daily', 1],
    ]);
    expect(fit.tree[1]).toMatchObject({ subfolders: ['Thesis', 'Website'], moreSubfolders: 0 });
    expect(fit).toMatchObject({ total: 6, placed: 4, open: 2 });
  });

  it('nests folders that share a parent, such as ACE or Johnny.Decimal areas', async () => {
    const fit = charterFit(presetCharter('ace', 'en'), await snapshot({ 'Atlas/Notes/Bread.md': 'Bread.' }), null);
    const atlas = fit.tree.find((node) => node.name === 'Atlas');
    expect(atlas).toMatchObject({ kind: 'group', notes: 1 });
    expect(atlas?.children.map((child) => child.name)).toEqual(['Maps', 'Notes', 'Sources', 'People']);
  });

  it('shows the vault root for a charter that keeps notes there', async () => {
    const fit = charterFit(presetCharter('flat-categories', 'en'), await snapshot({ 'Idea.md': 'Mine.', 'Book.md': '---\ncategories: ["[[Books]]"]\n---\n' }), null);
    expect(fit.tree.map((node) => [node.name, node.notes])).toEqual([
      ['Vault root', 1],
      ['References', 1],
      ['Clippings', 0],
      ['Categories', 0],
      ['Daily', 0],
    ]);
    expect(fit.open).toBe(0);
  });
});
