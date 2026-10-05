import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { buildSnapshot, isHiddenPath, type RawFile } from './build-snapshot';

function file(path: string, content?: string): RawFile {
  return { path, mtime: 1, ctime: 1, size: content?.length ?? 10, content };
}

async function build(files: RawFile[], folders: string[] = [], ignore: string[] = []) {
  return buildSnapshot({ files, folders, ignore, hasher: webCryptoHasher, now: 42 });
}

describe('buildSnapshot', () => {
  it('builds note records with resolved in- and out-links', async () => {
    const snapshot = await build([
      file('Home.md', 'Links to [[Projects/Alpha]] and [[Missing]] and ![[pic.png]]'),
      file('Projects/Alpha.md', '---\ntype: project\n---\n# Alpha\nBack to [[Home]] #active'),
      file('Orphan.md', 'Nobody links here.'),
      file('pic.png'),
    ]);

    expect(snapshot.notes.map((n) => n.path)).toEqual(['Home.md', 'Orphan.md', 'Projects/Alpha.md']);
    const [home, orphan, alpha] = snapshot.notes;
    expect(home?.outLinks).toEqual(['Projects/Alpha.md']);
    expect(home?.unresolvedLinks).toEqual(['Missing']);
    expect(home?.inLinks).toEqual(['Projects/Alpha.md']);
    expect(alpha).toMatchObject({
      basename: 'Alpha',
      folder: 'Projects',
      frontmatter: { type: 'project' },
      tags: ['active'],
      headings: [{ level: 1, text: 'Alpha' }],
      inLinks: ['Home.md'],
    });
    expect(orphan?.inLinks).toEqual([]);
    expect(snapshot.otherFiles).toEqual([{ path: 'pic.png', extension: 'png', size: 10 }]);
    expect(snapshot.takenAt).toBe(42);
  });

  it('hashes raw content so identical notes share a hash', async () => {
    const snapshot = await build([file('a.md', 'same'), file('b.md', 'same'), file('c.md', 'other')]);
    const [a, b, c] = snapshot.notes;
    expect(a?.contentHash).toBe(b?.contentHash);
    expect(a?.contentHash).not.toBe(c?.contentHash);
    expect(a?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('excludes hidden paths and ignored notes, and drops links to ignored notes', async () => {
    const snapshot = await build(
      [
        file('Note.md', 'Uses [[Template]]'),
        file('Templates/Template.md', 'Links to [[Note]]'),
        file('.obsidian/workspace.md', 'hidden'),
        file('.trash/Old.md', 'trashed'),
      ],
      [],
      ['Templates/**'],
    );
    expect(snapshot.notes.map((n) => n.path)).toEqual(['Note.md']);
    const note = snapshot.notes[0];
    expect(note?.outLinks).toEqual([]);
    expect(note?.unresolvedLinks).toEqual([]);
    expect(note?.inLinks).toEqual([]);
  });

  it('lists explicit empty folders and all ancestors, sorted', async () => {
    const snapshot = await build([file('a/b/c.md', 'x')], ['Empty', '.hidden', 'a']);
    expect(snapshot.folders).toEqual(['Empty', 'a', 'a/b']);
  });

  it('ignores self links', async () => {
    const snapshot = await build([file('Self.md', 'See [[Self]]')]);
    expect(snapshot.notes[0]?.outLinks).toEqual([]);
    expect(snapshot.notes[0]?.inLinks).toEqual([]);
  });
});

describe('isHiddenPath', () => {
  it('flags any dot segment', () => {
    expect(isHiddenPath('.obsidian/app.json')).toBe(true);
    expect(isHiddenPath('a/.git/x')).toBe(true);
    expect(isHiddenPath('a/b.md')).toBe(false);
  });
});
