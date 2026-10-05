import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../../core/hash';
import { createFakeApp, type RecordedVault } from '../testing/fake-app';
import { ObsidianVaultReader } from './obsidian-vault-reader';

const position = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } };
const stat = { ctime: 1, mtime: 2, size: 3 };

const recorded: RecordedVault = {
  files: [
    {
      path: 'Home.md',
      stat,
      cache: {
        frontmatter: { tags: ['hub'], created: '2026-01-15' },
        tags: [
          { tag: '#hub', position },
          { tag: '#Idea', position },
        ],
        headings: [{ heading: 'Home', level: 1, position }],
      },
    },
    { path: 'Projects/Plan.md', stat, cache: { headings: [{ heading: 'Plan', level: 1, position }] } },
    { path: 'Templates/T.md', stat, cache: {} },
    { path: 'Attachments/pic.png', stat, cache: null },
  ],
  folders: ['Projects', 'Templates', 'Attachments', 'Empty'],
  resolvedLinks: {
    'Home.md': { 'Projects/Plan.md': 2, 'Attachments/pic.png': 1, 'Home.md': 1 },
    'Templates/T.md': { 'Home.md': 1 },
    'Projects/Plan.md': {},
  },
  unresolvedLinks: { 'Home.md': { 'Someday': 1 }, 'Projects/Plan.md': {} },
};

const contents = { 'Home.md': '---\ntags: [hub]\n---\n# Home\nHello there [[Plan]]', 'Projects/Plan.md': '# Plan\n' };

describe('ObsidianVaultReader', () => {
  const reader = new ObsidianVaultReader(createFakeApp(recorded, contents), webCryptoHasher, { now: () => 7 });

  it('maps the metadata cache to note records', async () => {
    const snapshot = await reader.snapshot({ ignore: ['Templates/**'] });
    expect(snapshot.notes.map((n) => n.path)).toEqual(['Home.md', 'Projects/Plan.md']);
    expect(snapshot.notes[0]).toMatchObject({
      basename: 'Home',
      folder: '',
      frontmatter: { tags: ['hub'], created: '2026-01-15' },
      tags: ['hub', 'Idea'],
      headings: [{ level: 1, text: 'Home' }],
      outLinks: ['Projects/Plan.md'],
      unresolvedLinks: ['Someday'],
      inLinks: [],
      wordCount: 4,
      mtime: 2,
      ctime: 1,
      size: 3,
    });
    expect(snapshot.notes[1]).toMatchObject({ folder: 'Projects', inLinks: ['Home.md'] });
    expect(snapshot.takenAt).toBe(7);
  });

  it('lists folders and non-Markdown files', async () => {
    const snapshot = await reader.snapshot();
    expect(snapshot.folders).toEqual(['Attachments', 'Empty', 'Projects', 'Templates']);
    expect(snapshot.otherFiles).toEqual([{ path: 'Attachments/pic.png', extension: 'png', size: 3 }]);
  });

  it('hashes the same content the same way as the core', async () => {
    const snapshot = await reader.snapshot();
    expect(snapshot.notes[0]?.contentHash).toBe(await webCryptoHasher.sha256(contents['Home.md']));
  });

  it('reads files and checks existence', async () => {
    expect(await reader.read('Projects/Plan.md')).toBe('# Plan\n');
    expect(await reader.exists('Empty')).toBe(true);
    expect(await reader.exists('Nope.md')).toBe(false);
    await expect(reader.read('Nope.md')).rejects.toThrow('No such file');
  });
});
