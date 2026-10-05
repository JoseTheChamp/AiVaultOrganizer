import { describe, expect, it } from 'vitest';
import { parseFrontmatter, splitFrontmatter } from './frontmatter';
import { maskCode, parseNote } from './parse-note';

describe('frontmatter', () => {
  it('splits and parses YAML without converting dates', () => {
    const parsed = parseFrontmatter('---\ntype: project\ncreated: 2024-01-31\n---\n# Body\n');
    expect(parsed.data).toEqual({ type: 'project', created: '2024-01-31' });
    expect(parsed.valid).toBe(true);
    expect(parsed.body).toBe('# Body\n');
  });

  it('requires the fence on the first line', () => {
    expect(splitFrontmatter('\n---\na: 1\n---\n').yaml).toBeNull();
    expect(splitFrontmatter('---\na: 1\n').yaml).toBeNull();
  });

  it('handles CRLF and empty frontmatter', () => {
    expect(parseFrontmatter('---\r\na: 1\r\n---\r\nBody').data).toEqual({ a: 1 });
    expect(parseFrontmatter('---\n---\nBody')).toEqual({ data: {}, valid: true, body: 'Body' });
  });

  it('reports invalid YAML without throwing', () => {
    const parsed = parseFrontmatter('---\na: [unclosed\n---\nBody');
    expect(parsed.valid).toBe(false);
    expect(parsed.data).toEqual({});
    expect(parseFrontmatter('---\n- just\n- a list\n---\n').valid).toBe(false);
  });
});

describe('parseNote', () => {
  it('collects frontmatter and inline tags, de-duplicated, without #', () => {
    const note = parseNote('---\ntags: [Project, "#reading"]\n---\nSome #idea and #project/web and #Project.\n');
    expect(note.tags).toEqual(['Project', 'reading', 'idea', 'project/web']);
  });

  it('accepts a comma or space separated tags string and the singular key', () => {
    expect(parseNote('---\ntag: a, b c\n---\n').tags).toEqual(['a', 'b', 'c']);
  });

  it('ignores headings, numbers, anchors and code as tags', () => {
    const note = parseNote(
      '# Heading\n#2024 is a year\nSee https://example.com/#section and [[Note#Part]]\n`#code` and\n```\n#fenced\n```\n',
    );
    expect(note.tags).toEqual([]);
  });

  it('supports unicode tags', () => {
    expect(parseNote('Téma #čtení a #zdraví/spánek').tags).toEqual(['čtení', 'zdraví/spánek']);
  });

  it('extracts ATX headings outside code blocks', () => {
    const note = parseNote('# Title\nText\n## Sub heading ##\n```\n# not a heading\n```\n####### too deep\n');
    expect(note.headings).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Sub heading' },
    ]);
  });

  it('extracts wikilinks, embeds, markdown links and frontmatter links', () => {
    const note = parseNote(
      [
        '---',
        'categories: ["[[Books]]"]',
        '---',
        'See [[Alpha]], [[Beta|the beta]], [[Gamma#Section]], [[Delta#^block]] and ![[diagram.png]].',
        'Also [text](Folder/Epsilon%20Note.md), [web](https://example.com), [anchor](#top), ![img](<a b.png>).',
        'Self link [[#Heading]] is ignored. Table | [[Zeta\\|alias]] |',
        '```',
        '[[InsideCode]]',
        '```',
      ].join('\n'),
    );
    expect(note.links).toEqual([
      { target: 'Books', embed: false, source: 'frontmatter' },
      { target: 'Alpha', embed: false, source: 'wikilink' },
      { target: 'Beta', embed: false, source: 'wikilink' },
      { target: 'Gamma', embed: false, source: 'wikilink' },
      { target: 'Delta', embed: false, source: 'wikilink' },
      { target: 'diagram.png', embed: true, source: 'wikilink' },
      { target: 'Zeta', embed: false, source: 'wikilink' },
      { target: 'Folder/Epsilon Note.md', embed: false, source: 'markdown' },
      { target: 'a b.png', embed: true, source: 'markdown' },
    ]);
  });

  it('counts words in prose only', () => {
    const note = parseNote("---\ntitle: ignored words here\n---\nIt's a well-known fact.\n```\ncode words\n```\nPříliš žluťoučký kůň");
    expect(note.wordCount).toBe(7);
  });
});

describe('maskCode', () => {
  it('blanks fenced blocks and inline spans but keeps line count', () => {
    const masked = maskCode('a `b` c\n~~~\nx\n~~~\nd');
    expect(masked.split('\n')).toHaveLength(5);
    expect(masked).not.toContain('b');
    expect(masked).not.toContain('x');
  });

  it('only closes a fence with the same marker of at least the same length', () => {
    const masked = maskCode('````\n```\nhidden\n````\nshown');
    expect(masked).not.toContain('hidden');
    expect(masked).toContain('shown');
  });
});
