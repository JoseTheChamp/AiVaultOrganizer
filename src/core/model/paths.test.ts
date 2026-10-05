import { describe, expect, it } from 'vitest';
import {
  ancestorFolders,
  baseName,
  depth,
  extension,
  fileName,
  isInFolder,
  joinPath,
  normalizeVaultPath,
  parentFolder,
} from './paths';

describe('normalizeVaultPath', () => {
  it.each([
    ['a/b.md', 'a/b.md'],
    ['/a//b.md/', 'a/b.md'],
    ['a\\b\\c.md', 'a/b/c.md'],
    ['./a/./b.md', 'a/b.md'],
    ['a/x/../b.md', 'a/b.md'],
    ['', ''],
    ['/', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeVaultPath(input)).toBe(expected);
  });

  it('normalizes unicode to NFC so Czech names compare equal', () => {
    const decomposed = 'Poznámky.md';
    expect(normalizeVaultPath(decomposed)).toBe('Poznámky.md');
  });
});

describe('path parts', () => {
  it('splits paths', () => {
    expect(parentFolder('a/b/c.md')).toBe('a/b');
    expect(parentFolder('c.md')).toBe('');
    expect(fileName('a/b/c.md')).toBe('c.md');
    expect(baseName('a/b/my.note.md')).toBe('my.note');
    expect(baseName('a/.hidden')).toBe('.hidden');
    expect(extension('a/B.MD')).toBe('md');
    expect(extension('a/README')).toBe('');
    expect(joinPath('a', '', 'b', 'c.md')).toBe('a/b/c.md');
  });

  it('computes depth and ancestors', () => {
    expect(depth('a.md')).toBe(0);
    expect(depth('x/y/a.md')).toBe(2);
    expect(ancestorFolders('x/y/a.md')).toEqual(['x', 'x/y']);
    expect(ancestorFolders('a.md')).toEqual([]);
  });

  it('checks folder containment without prefix false positives', () => {
    expect(isInFolder('Projects/a.md', 'Projects')).toBe(true);
    expect(isInFolder('Projects', 'Projects')).toBe(true);
    expect(isInFolder('Projects2/a.md', 'Projects')).toBe(false);
    expect(isInFolder('anything.md', '')).toBe(true);
  });
});
