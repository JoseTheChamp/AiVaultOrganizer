import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type GroundTruth, loadFixture, type NoteTruth, pairKey, validateGroundTruth, writeGroundTruth } from './ground-truth';

const note = (overrides: Partial<NoteTruth> = {}): NoteTruth => ({
  persona: 'dev',
  entity: 'website',
  kind: 'note',
  topic: 'Web development',
  destinations: {
    para: { id: 'projects', subfolder: 'Website relaunch' },
    ace: { id: 'efforts-on', subfolder: 'Website relaunch' },
    jd: { id: 'jd-21' },
    flat: { id: 'root' },
    topics: { id: 'notes', subfolder: 'Web development' },
  },
  isStub: false,
  ...overrides,
});

const truth = (overrides: Partial<GroundTruth> = {}): GroundTruth => ({
  version: 1,
  fixture: 'mini',
  language: 'en',
  seed: 1,
  notes: { 'a.md': note(), 'b.md': note({ kind: 'daily', destinations: { ...note().destinations, para: { id: 'daily' } } }) },
  trueLinks: [['a.md', 'b.md']],
  heldOutLinks: [],
  ...overrides,
});

describe('validateGroundTruth', () => {
  it('accepts a consistent ground truth', () => {
    expect(validateGroundTruth(truth(), new Set(['a.md', 'b.md']))).toEqual([]);
  });

  it('reports missing notes, unknown destinations, dangling duplicates and links', () => {
    const broken = truth({
      notes: {
        'a.md': note({ destinations: { ...note().destinations, ace: { id: 'efforts-nowhere' } }, duplicateOf: 'gone.md' }),
        'ghost.md': note(),
      },
      heldOutLinks: [['a.md', 'gone.md']],
    });
    expect(validateGroundTruth(broken, new Set(['a.md', 'b.md']))).toEqual([
      'b.md: note has no ground truth',
      'a.md: unknown ace destination "efforts-nowhere"',
      'a.md: duplicate of missing note gone.md',
      'ghost.md: ground truth for a missing note',
      'heldOutLinks: pair with a missing note (a.md, gone.md)',
    ]);
  });

  it('checks destinations against the preset of the fixture language', () => {
    const czech = truth({ language: 'cs', notes: { 'a.md': note({ destinations: { ...note().destinations, jd: { id: 'jd-99' } } }) }, trueLinks: [] });
    expect(validateGroundTruth(czech, new Set(['a.md']))).toEqual(['a.md: unknown jd destination "jd-99"']);
  });
});

describe('pairKey', () => {
  it('ignores pair order', () => {
    expect(pairKey('b.md', 'a.md')).toBe(pairKey('a.md', 'b.md'));
    expect(pairKey('a.md', 'b.md')).not.toBe(pairKey('a.md', 'c.md'));
  });
});

describe('loadFixture', () => {
  let dir = '';
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('reads the notes and their hidden ground truth, and refuses inconsistent fixtures', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avo-fixture-'));
    await writeFile(path.join(dir, 'a.md'), 'Links to [[b]].');
    await writeFile(path.join(dir, 'b.md'), 'Daily.');
    await writeGroundTruth(dir, truth());
    const fixture = await loadFixture(dir);
    expect(fixture.name).toBe('mini');
    expect((await fixture.vault.snapshot()).notes.map((n) => n.path)).toEqual(['a.md', 'b.md']);

    await writeFile(path.join(dir, 'c.md'), 'Unlabelled.');
    await expect(loadFixture(dir)).rejects.toThrow(/c\.md: note has no ground truth/);
  });
});
