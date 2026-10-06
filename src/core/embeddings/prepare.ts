import { splitFrontmatter } from '../markdown/frontmatter';
import { maskCode } from '../markdown/parse-note';

/**
 * Bump when preparation, term extraction or chunking changes what an index would contain; stored
 * indexes with another version are rebuilt instead of mixing old and new entries.
 */
export const TEXT_VERSION = 1;

/** A run of plain text under one heading. */
export interface Section {
  /** Headings from the outermost down to this section's own; empty before the first heading. */
  trail: string[];
  /** Paragraphs in order; lines of one paragraph (list items, for example) are joined with `\n`. */
  paragraphs: string[];
}

/** A note reduced to what carries meaning for similarity: its title and its prose by section. */
export interface PreparedNote {
  title: string;
  sections: Section[];
}

const COMMENTS = /<!--[\s\S]*?-->|%%[\s\S]*?%%/g;
const EMBED = /!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g;
const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const URL = /\b(?:https?|ftp|file|obsidian):\/\/\S+/gi;
const HTML_TAG = /<\/?[a-z][^>\n]*>/gi;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const QUOTE = /^\s*(?:>\s?)+/;
const CALLOUT = /^\[![^\]\n]+\][+-]?\s*/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]\n]\]\s+)?/;
const RULE_OR_TABLE_DIVIDER = /^\s*(?:(?:[-*_]\s*){3,}|\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*)$/;
const FOOTNOTE_REF = /\[\^[^\]\n]+\]/g;
const BLOCK_ID = /\s\^[\w-]+\s*$/;
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;
const EMPHASIS = /\*{1,3}|={2}|~{2}|(?<=^|\s)_{1,3}|_{1,3}(?=\s|$|[.,;:!?])/g;

/**
 * Prepares a note for embeddings and word statistics (PLAN §7.3): frontmatter, code, comments,
 * embeds and URLs are dropped; links become their visible text; Markdown syntax is removed; headings
 * split the body into sections. The result is deterministic, so the same content always produces the
 * same text and therefore the same cached vector.
 */
export function prepareNote(content: string, title: string): PreparedNote {
  const body = maskCode(splitFrontmatter(content).body).replace(COMMENTS, (comment) => '\n'.repeat(countNewlines(comment)));
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Section = { trail: [], paragraphs: [] };
  let paragraph: string[] = [];

  const endParagraph = (): void => {
    if (paragraph.length > 0) current.paragraphs.push(paragraph.join('\n'));
    paragraph = [];
  };
  const endSection = (): void => {
    endParagraph();
    if (current.trail.length > 0 || current.paragraphs.length > 0) sections.push(current);
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const heading = HEADING.exec(rawLine);
    if (heading?.[1] && heading[2] !== undefined) {
      const text = cleanInline(heading[2]);
      if (text === '') continue;
      endSection();
      const level = heading[1].length;
      while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
      stack.push({ level, text });
      current = { trail: stack.map((entry) => entry.text), paragraphs: [] };
      continue;
    }
    if (RULE_OR_TABLE_DIVIDER.test(rawLine)) {
      endParagraph();
      continue;
    }
    const line = cleanLine(rawLine);
    if (line === '') endParagraph();
    else paragraph.push(line);
  }
  endSection();
  return { title: title.trim(), sections };
}

/** Title, headings and paragraphs as one plain text; what word statistics see. */
export function preparedText(note: PreparedNote): string {
  const parts = [note.title];
  for (const section of note.sections) {
    const own = section.trail.at(-1);
    if (own) parts.push(own);
    parts.push(...section.paragraphs);
  }
  return parts.filter((part) => part !== '').join('\n');
}

function cleanLine(line: string): string {
  const unquoted = line.replace(QUOTE, '').replace(CALLOUT, '');
  return cleanInline(unquoted.replace(LIST_MARKER, ''));
}

function cleanInline(text: string): string {
  return text
    .replace(EMBED, ' ')
    .replace(WIKILINK, (_match, target: string, alias: string | undefined) => alias ?? linkTitle(target))
    .replace(MARKDOWN_LINK, '$1')
    .replace(URL, ' ')
    .replace(HTML_TAG, ' ')
    .replace(FOOTNOTE_REF, '')
    .replace(BLOCK_ID, '')
    .replace(INLINE_TAG, (_match, space: string, tag: string) => `${space}${tag.replace(/[/_-]+/g, ' ')}`)
    .replace(EMPHASIS, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Folder/Note#Heading` → `Note Heading`: what a reader sees as the link's meaning. */
function linkTitle(target: string): string {
  const [path = '', ...subpath] = target.split('#');
  const name = path.split('/').at(-1) ?? path;
  return [name, ...subpath.map((part) => part.replace(/^\^/, ''))].filter((part) => part !== '').join(' ');
}

function countNewlines(text: string): number {
  let count = 0;
  for (const char of text) if (char === '\n') count++;
  return count;
}
