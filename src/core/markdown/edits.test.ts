import { describe, expect, it } from 'vitest';
import { rewriteFrontmatter } from './frontmatter-edit';
import { listGeneratedSections, replaceGeneratedSection, wrapGeneratedSection } from './generated-sections';
import { parseNote } from './parse-note';
import { mapProse } from './prose';
import { insertRelatedLinks } from './related-links';
import { rewriteLinks } from './rewrite-links';
import { addTagsToFrontmatter, replaceInlineTag, replaceTagInFrontmatter } from './tags-edit';

describe('mapProse', () => {
  it('skips fenced blocks and inline code and keeps line endings', () => {
    const text = 'a `a` a\r\n```\na\n```\na';
    expect(mapProse(text, (s) => s.replaceAll('a', 'b'))).toBe('b `a` b\r\n```\na\n```\nb');
  });
});

describe('rewriteFrontmatter', () => {
  it('adds frontmatter to a note without it', () => {
    expect(rewriteFrontmatter('# Note\n', (fm) => (fm.type = 'project'))).toBe('---\ntype: project\n---\n# Note\n');
  });

  it('keeps the file untouched when nothing changes', () => {
    const content = '---\na:   1   # comment\n---\nBody';
    expect(rewriteFrontmatter(content, (fm) => (fm.a = 1))).toBe(content);
  });

  it('updates existing keys and keeps dates as strings', () => {
    const result = rewriteFrontmatter('---\ncreated: 2024-01-31\n---\nBody', (fm) => (fm.status = 'done'));
    expect(result).toBe('---\ncreated: 2024-01-31\nstatus: done\n---\nBody');
  });

  it('refuses to overwrite invalid YAML', () => {
    expect(() => rewriteFrontmatter('---\n- a\n---\n', (fm) => (fm.x = 1))).toThrow();
  });
});

describe('tag edits', () => {
  it('adds tags once, case-insensitively, converting a single string to a list', () => {
    const fm: Record<string, unknown> = { Tags: 'Book' };
    expect(addTagsToFrontmatter(fm, ['#book', 'reading', 'reading'])).toEqual(['reading']);
    expect(fm).toEqual({ Tags: ['Book', 'reading'] });
    expect(addTagsToFrontmatter(fm, ['READING'])).toEqual([]);
  });

  it('renames frontmatter tags including nested children without duplicates', () => {
    const fm: Record<string, unknown> = { tags: ['ProjectX', 'ProjectX/web', 'project-x', 7] };
    expect(replaceTagInFrontmatter(fm, 'ProjectX', 'project-x')).toBe(true);
    expect(fm.tags).toEqual(['project-x', 'project-x/web', 7]);
    expect(replaceTagInFrontmatter(fm, 'Missing', 'x')).toBe(false);
  });

  it('renames inline tags outside code and frontmatter, exact spelling only', () => {
    const content = '---\ntitle: "#ProjectX"\n---\n#ProjectX and #ProjectX/web and #ProjectXL and #projectx\n`#ProjectX`\n';
    const result = replaceInlineTag(content, 'ProjectX', 'project-x');
    expect(result).toBe('---\ntitle: "#ProjectX"\n---\n#project-x and #project-x/web and #ProjectXL and #projectx\n`#ProjectX`\n');
    expect(parseNote(result).tags).toEqual(['project-x', 'project-x/web', 'ProjectXL', 'projectx']);
  });
});

describe('insertRelatedLinks', () => {
  it('appends a heading with links when missing', () => {
    const result = insertRelatedLinks('# Note\n\nText.\n', '## Related', ['A', 'B']);
    expect(result).toEqual({ content: '# Note\n\nText.\n\n## Related\n- [[A]]\n- [[B]]\n', inserted: ['A', 'B'] });
  });

  it('adds to the existing section before the next heading', () => {
    const content = '# Note\n## Související\n- [[A]]\n\n## Later\nx\n';
    const result = insertRelatedLinks(content, '## Související', ['B']);
    expect(result.content).toBe('# Note\n## Související\n- [[A]]\n- [[B]]\n\n## Later\nx\n');
  });

  it('is idempotent and skips links present anywhere, with alias or heading', () => {
    const content = 'See [[A|alias]] and [[B#Part]].\n';
    expect(insertRelatedLinks(content, '## Related', ['A', 'B'])).toEqual({ content, inserted: [] });
    const once = insertRelatedLinks('x', '## Related', ['C']).content;
    expect(insertRelatedLinks(once, '## Related', ['C']).content).toBe(once);
  });

  it('ignores headings inside code blocks and keeps frontmatter', () => {
    const content = '---\na: 1\n---\n```\n## Related\n```\n';
    expect(insertRelatedLinks(content, '## Related', ['A']).content).toBe('---\na: 1\n---\n```\n## Related\n```\n\n## Related\n- [[A]]\n');
  });
});

describe('generated sections', () => {
  const content = `Intro\n${wrapGeneratedSection('overview', 'Old')}\nMine\n${wrapGeneratedSection('rules', 'R')}\n`;

  it('lists and replaces a section, preserving user text', () => {
    expect(listGeneratedSections(content)).toEqual([
      { id: 'overview', inner: 'Old' },
      { id: 'rules', inner: 'R' },
    ]);
    const result = replaceGeneratedSection(content, 'overview', '\nNew text\n');
    expect(result.ok && result.value).toBe(`Intro\n${wrapGeneratedSection('overview', 'New text')}\nMine\n${wrapGeneratedSection('rules', 'R')}\n`);
  });

  it('fails on missing or malformed sections', () => {
    expect(replaceGeneratedSection(content, 'nope', 'x')).toEqual({ ok: false, error: 'missing' });
    expect(replaceGeneratedSection('<!-- charter:generated:start id="a" -->\nx', 'a', 'y')).toEqual({ ok: false, error: 'malformed' });
  });
});

describe('rewriteLinks', () => {
  it('rewrites wikilinks and Markdown links but keeps subpaths, aliases, embeds and code', () => {
    const content = [
      '---',
      'up: "[[Old]]"',
      '---',
      '[[Old]] [[Old#H|alias]] ![[Old]] [[Other]] | [[Old\\|t]] |',
      '[x](Folder/Old.md#h) [y](<Folder/Old.md>) [web](https://e.com/Old.md)',
      '`[[Old]]`',
    ].join('\n');
    const result = rewriteLinks(content, (link) =>
      link.target === 'Old' ? 'New/Name' : link.target === 'Folder/Old.md' ? 'New/My Name.md' : null,
    );
    expect(result).toBe(
      [
        '---',
        'up: "[[New/Name]]"',
        '---',
        '[[New/Name]] [[New/Name#H|alias]] ![[New/Name]] [[Other]] | [[New/Name\\|t]] |',
        '[x](New/My%20Name.md#h) [y](<New/My Name.md>) [web](https://e.com/Old.md)',
        '`[[Old]]`',
      ].join('\n'),
    );
  });
});
