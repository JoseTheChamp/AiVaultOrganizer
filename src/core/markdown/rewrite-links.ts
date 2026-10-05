import { splitFrontmatter } from './frontmatter';
import { mapProse } from './prose';

export interface LinkOccurrence {
  /** Link path without subpath or alias, URL-decoded for Markdown links. */
  target: string;
  kind: 'wikilink' | 'markdown';
  embed: boolean;
}

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK = /(!?)(\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Rewrites link targets in a note: `replace` returns the new target (wikilink text without `.md`,
 * or a Markdown link path) or null to keep a link. Subpaths, aliases and embed markers are kept;
 * code is untouched. Used by non-Obsidian adapters to imitate how Obsidian updates links when a
 * file moves.
 */
export function rewriteLinks(content: string, replace: (link: LinkOccurrence) => string | null): string {
  const { body } = splitFrontmatter(content);
  const head = content.slice(0, content.length - body.length);
  return rewriteWikilinks(head, replace) + mapProse(body, (segment) => rewriteMarkdownLinks(rewriteWikilinks(segment, replace), replace));
}

function rewriteWikilinks(text: string, replace: (link: LinkOccurrence) => string | null): string {
  return text.replace(WIKILINK, (whole, bang: string, inner: string) => {
    const cut = firstDelimiter(inner);
    const target = inner.slice(0, cut).trim();
    if (target === '') return whole;
    const next = replace({ target, kind: 'wikilink', embed: bang === '!' });
    return next === null ? whole : `${bang}[[${next}${inner.slice(cut)}]]`;
  });
}

function rewriteMarkdownLinks(text: string, replace: (link: LinkOccurrence) => string | null): string {
  return text.replace(MARKDOWN_LINK, (whole, bang: string, open: string, rawTarget: string, close: string) => {
    const angle = rawTarget.startsWith('<') && rawTarget.endsWith('>');
    const raw = angle ? rawTarget.slice(1, -1) : rawTarget;
    if (URL_SCHEME.test(raw) || raw.startsWith('#')) return whole;
    const hashIndex = raw.indexOf('#');
    const pathPart = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
    const subpath = hashIndex === -1 ? '' : raw.slice(hashIndex);
    let target = pathPart;
    try {
      target = decodeURIComponent(pathPart);
    } catch {
      // Keep undecodable targets as written.
    }
    const next = replace({ target, kind: 'markdown', embed: bang === '!' });
    if (next === null) return whole;
    const written = angle ? `<${next}${subpath}>` : `${encodeURI(next)}${subpath}`;
    return `${bang}${open}${written}${close}`;
  });
}

/** Index where the link path ends: at `#`, `|` or a table-escaped `\|`. */
function firstDelimiter(inner: string): number {
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '#' || ch === '|') return i;
    if (ch === '\\' && inner[i + 1] === '|') return i;
  }
  return inner.length;
}
