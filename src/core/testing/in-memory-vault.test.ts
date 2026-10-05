import { describe, expect, it } from 'vitest';
import { tinyParaVault } from './fixtures';
import { InMemoryVault } from './in-memory-vault';
import { MemoryStorage } from './memory-storage';

describe('InMemoryVault as a reader', () => {
  it('snapshots a fixture vault', async () => {
    const { files, folders } = tinyParaVault();
    const vault = InMemoryVault.from(files, { folders });
    const snapshot = await vault.snapshot();

    expect(snapshot.notes).toHaveLength(13);
    expect(snapshot.otherFiles.map((f) => f.path)).toEqual(['Attachments/diagram.png']);
    expect(snapshot.folders).toContain('3 Resources/Empty topic');
    const relaunch = snapshot.notes.find((n) => n.basename === 'Website relaunch');
    expect(relaunch?.inLinks).toEqual(['0 Inbox/Call notes.md', 'Daily/2026-09-30.md']);
  });

  it('applies ignore globs', async () => {
    const { files } = tinyParaVault();
    const snapshot = await InMemoryVault.from(files).snapshot({ ignore: ['Templates/**', 'Daily/**'] });
    expect(snapshot.notes.some((n) => n.path.startsWith('Templates/') || n.path.startsWith('Daily/'))).toBe(false);
  });

  it('reads text and bytes and reports existence', async () => {
    const vault = InMemoryVault.from({ 'a/b.md': 'hello' });
    expect(await vault.read('a/b.md')).toBe('hello');
    expect(await vault.readBinary('a/b.md')).toEqual(new TextEncoder().encode('hello'));
    expect(await vault.exists('a')).toBe(true);
    await expect(vault.read('missing.md')).rejects.toThrow('No such file');
  });
});

describe('InMemoryVault as a writer', () => {
  it('updates links like Obsidian when a note moves', async () => {
    const vault = InMemoryVault.from(
      {
        'Home.md': '[[Plan]] [[Inbox/Plan|alias]] [p](Inbox/Plan.md) [[Other]]',
        'Inbox/Plan.md': 'Back to [[Home]] and [sibling](Sibling.md)',
        'Inbox/Sibling.md': '',
        // Same name in the target folder: the moved note's own link must keep pointing to Inbox.
        'Projects/Sibling.md': '',
        'Other.md': '',
      },
    );
    await vault.move('Inbox/Plan.md', 'Projects/Plan.md');
    expect(vault.contents()).toEqual({
      'Home.md': '[[Plan]] [[Plan|alias]] [p](Projects/Plan.md) [[Other]]',
      'Inbox/Sibling.md': '',
      'Other.md': '',
      'Projects/Plan.md': 'Back to [[Home]] and [sibling](Inbox/Sibling.md)',
      'Projects/Sibling.md': '',
    });
    expect(await vault.backlinks('Projects/Plan.md')).toEqual(['Home.md']);
  });

  it('keeps links resolvable when a rename makes a name ambiguous', async () => {
    const vault = InMemoryVault.from({ 'A/Note.md': '', 'B/Other.md': '', 'Home.md': '[[Other]]' });
    await vault.move('B/Other.md', 'B/Note.md');
    expect(await vault.read('Home.md')).toBe('[[B/Note]]');
    expect((await vault.graph()).unresolvedCount).toBe(0);
  });

  it('edits frontmatter and bodies, creates and trashes notes', async () => {
    const vault = InMemoryVault.from({ 'a.md': 'Body' });
    await vault.processFrontmatter('a.md', (fm) => (fm.type = 'note'));
    expect(await vault.read('a.md')).toBe('---\ntype: note\n---\nBody');
    await vault.processBody('a.md', (c) => `${c}!`);
    expect(await vault.read('a.md')).toBe('---\ntype: note\n---\nBody!');

    await vault.createFolder('New');
    await vault.create('New/moc.md', '# MOC');
    await expect(vault.create('New/moc.md', 'again')).rejects.toThrow('Already exists');
    await expect(vault.create('Missing/x.md', '')).rejects.toThrow('No such folder');
    await vault.trashPluginCreated('New/moc.md');
    expect(vault.trash).toEqual([{ path: 'New/moc.md', content: '# MOC' }]);
    expect(await vault.removeEmptyFolder('New')).toBe(true);
    expect(await vault.exists('New')).toBe(false);
  });

  it('only removes folders that are really empty', async () => {
    const vault = InMemoryVault.from({ 'F/a.md': '' }, { folders: ['G/H'] });
    expect(await vault.removeEmptyFolder('F')).toBe(false);
    expect(await vault.removeEmptyFolder('G')).toBe(false);
    expect(await vault.removeEmptyFolder('G/H')).toBe(true);
  });

  it('reports a link graph with attachments and unresolved links', async () => {
    const vault = InMemoryVault.from({ 'a.md': '[[b]] ![[pic.png]] [[gone]]', 'b.md': '', 'pic.png': 'x' });
    expect(await vault.graph()).toEqual({ edges: [['a.md', 'b.md'], ['a.md', 'pic.png']], unresolvedCount: 1 });
    expect(await vault.linkText('b.md')).toBe('b');
  });
});

describe('MemoryStorage', () => {
  it('reads, writes, appends, lists and removes', async () => {
    const storage = new MemoryStorage();
    const enc = (s: string) => new TextEncoder().encode(s);
    await storage.write('journal/1.jsonl', enc('a\n'));
    await storage.append('journal/1.jsonl', enc('b\n'));
    await storage.append('journal/2.jsonl', enc('c\n'));
    expect(storage.text('journal/1.jsonl')).toBe('a\nb\n');
    expect(await storage.list('journal/')).toEqual(['journal/1.jsonl', 'journal/2.jsonl']);
    await storage.remove('journal/1.jsonl');
    expect(await storage.read('journal/1.jsonl')).toBeNull();
  });
});
