import type { Heading } from '../model/note';
import { parseFrontmatter } from './frontmatter';

/** A link as written in a note, before resolution. */
export interface RawLink {
  /** Link path without alias, heading or block subpath, URL-decoded for Markdown links. */
  target: string;
  embed: boolean;
  source: 'wikilink' | 'markdown' | 'frontmatter';
}

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  frontmatterValid: boolean;
  /** Frontmatter tags first, then inline tags; without `#`, de-duplicated case-sensitively. */
  tags: string[];
  headings: Heading[];
  links: RawLink[];
  wordCount: number;
  /** Body without frontmatter and with code masked out; used for excerpts and text analysis. */
  prose: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;
const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK = /(!?)\[[^\]\n]*\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/**
 * Parses the parts of a Markdown note the snapshot needs. Intentionally small: it mirrors what
 * Obsidian's metadata cache reports (frontmatter, tags, headings, links) closely enough for the
 * adapter contract test, without being a full CommonMark parser.
 */
export function parseNote(content: string): ParsedNote {
  const { data, valid, body } = parseFrontmatter(content);
  const prose = maskCode(body);

  const headings: Heading[] = [];
  for (const line of prose.split('\n')) {
    const match = HEADING.exec(line);
    if (match?.[1] && match[2] !== undefined && match[2].trim() !== '') {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }

  const tags = unique([...frontmatterTags(data), ...inlineTags(prose)]);
  const links = [...frontmatterLinks(data), ...bodyLinks(prose)];
  const wordCount = prose.match(WORD)?.length ?? 0;

  return { frontmatter: data, frontmatterValid: valid, tags, headings, links, wordCount, prose };
}

/** Replaces fenced code blocks and inline code spans with blanks, keeping line structure. */
export function maskCode(body: string): string {
  const lines = body.split(/\r?\n/);
  let fence: string | null = null;
  const result: string[] = [];
  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      if (fenceMatch?.[1] && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      result.push('');
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = fenceMatch[1];
      result.push('');
      continue;
    }
    result.push(line.replace(/(`+)[^`]*?\1/g, (span) => ' '.repeat(span.length)));
  }
  return result.join('\n');
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\/+$/, '');
}

function isValidTag(tag: string): boolean {
  // Obsidian requires at least one non-numeric character (#2024 is not a tag).
  return tag.length > 0 && !/^[\d/]+$/.test(tag);
}

function frontmatterTags(data: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!/^tags?$/i.test(key)) continue;
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
    for (const item of values) {
      if (typeof item !== 'string' && typeof item !== 'number') continue;
      const tag = normalizeTag(String(item));
      if (isValidTag(tag)) result.push(tag);
    }
  }
  return result;
}

function inlineTags(prose: string): string[] {
  const result: string[] = [];
  for (const match of prose.matchAll(INLINE_TAG)) {
    const tag = normalizeTag(match[1] ?? '');
    if (isValidTag(tag)) result.push(tag);
  }
  return result;
}

/** Obsidian indexes wikilinks written inside frontmatter properties, e.g. `categories: "[[Books]]"`. */
function frontmatterLinks(data: Record<string, unknown>): RawLink[] {
  const result: RawLink[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(WIKILINK)) {
        const target = wikilinkTarget(match[2] ?? '');
        if (target) result.push({ target, embed: false, source: 'frontmatter' });
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    }
  };
  Object.values(data).forEach(visit);
  return result;
}

function bodyLinks(prose: string): RawLink[] {
  const result: RawLink[] = [];
  for (const match of prose.matchAll(WIKILINK)) {
    const target = wikilinkTarget(match[2] ?? '');
    if (target) result.push({ target, embed: match[1] === '!', source: 'wikilink' });
  }
  for (const match of prose.matchAll(MARKDOWN_LINK)) {
    const target = markdownLinkTarget(match[2] ?? '');
    if (target) result.push({ target, embed: match[1] === '!', source: 'markdown' });
  }
  return result;
}

function wikilinkTarget(inner: string): string {
  // Inside tables the alias pipe is escaped as `\|`, which leaves a trailing backslash.
  const withoutAlias = (inner.split('|')[0] ?? '').replace(/\\$/, '');
  return (withoutAlias.split('#')[0] ?? '').trim();
}

function markdownLinkTarget(raw: string): string {
  let target = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  if (URL_SCHEME.test(target) || target.startsWith('#')) return '';
  target = target.split('#')[0] ?? '';
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the raw target when it is not valid percent-encoding.
  }
  return target.trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
