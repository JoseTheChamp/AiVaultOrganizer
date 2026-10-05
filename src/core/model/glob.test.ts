import { describe, expect, it } from 'vitest';
import { matchesAnyGlob, matchesGlob } from './glob';

describe('matchesGlob', () => {
  it.each([
    ['Templates/**', 'Templates/Daily.md', true],
    ['Templates/**', 'Templates/sub/Daily.md', true],
    ['Templates/**', 'MyTemplates/Daily.md', false],
    ['**/*.excalidraw.md', 'Drawing.excalidraw.md', true],
    ['**/*.excalidraw.md', 'a/b/Drawing.excalidraw.md', true],
    ['**/*.excalidraw.md', 'a/b/Drawing.md', false],
    ['*.md', 'Note.md', true],
    ['*.md', 'a/Note.md', false],
    ['Daily/????-??-??.md', 'Daily/2024-01-31.md', true],
    ['Daily/????-??-??.md', 'Daily/2024-1-31.md', false],
    ['{Inbox,Capture}/*', 'Capture/x.md', true],
    ['{Inbox,Capture}/*', 'Other/x.md', false],
    ['Notes/[ab]*.md', 'Notes/apple.md', true],
    ['Notes/[ab]*.md', 'Notes/cherry.md', false],
    ['Šablony/**', 'Šablony/Den.md', true],
  ])('%s matches %s → %s', (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });

  it('treats a pattern without wildcards as a folder prefix', () => {
    expect(matchesGlob('Templates', 'Templates')).toBe(true);
    expect(matchesGlob('Templates/a.md', 'Templates')).toBe(true);
    expect(matchesGlob('Templates/a.md', 'Templates/')).toBe(true);
    expect(matchesGlob('Templates2/a.md', 'Templates')).toBe(false);
  });

  it('escapes regex characters in literal parts', () => {
    expect(matchesGlob('a+b (1).md', 'a+b (1).md')).toBe(true);
    expect(matchesGlob('aab (1).md', 'a+b (1).md')).toBe(false);
  });

  it('matches any of several globs', () => {
    expect(matchesAnyGlob('x/y.md', ['a/**', 'x/**'])).toBe(true);
    expect(matchesAnyGlob('x/y.md', [])).toBe(false);
  });
});
