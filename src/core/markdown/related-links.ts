import { splitFrontmatter } from './frontmatter';
import { FENCE } from './prose';

export interface RelatedLinksResult {
  content: string;
  /** Link texts that were actually inserted. */
  inserted: string[];
}

const HEADING_LINE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * Lists `[[link]]` items under the related-notes heading (e.g. `## Related`), creating the
 * heading at the end of the note when missing. Links already present anywhere in the note are
 * skipped, so applying the same operation twice changes nothing (idempotent, §7.5).
 */
export function insertRelatedLinks(content: string, heading: string, linkTexts: readonly string[]): RelatedLinksResult {
  const { level, text } = parseHeading(heading);
  const wanted = [...new Set(linkTexts)].filter((link) => !alreadyLinked(content, link));
  if (wanted.length === 0) return { content, inserted: [] };
  const items = wanted.map((link) => `- [[${link}]]`);

  const { body } = splitFrontmatter(content);
  const head = content.slice(0, content.length - body.length);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);

  const section = findSection(lines, text);
  if (section) {
    let insertAt = section.end;
    while (insertAt > section.start + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
    lines.splice(insertAt, 0, ...items);
    return { content: head + lines.join(newline), inserted: wanted };
  }

  const trimmed = body.replace(/\s+$/, '');
  const prefix = trimmed === '' ? '' : `${trimmed}${newline}${newline}`;
  const block = `${'#'.repeat(level)} ${text}${newline}${items.join(newline)}${newline}`;
  return { content: head + prefix + block, inserted: wanted };
}

function parseHeading(heading: string): { level: number; text: string } {
  const match = /^(#{1,6})\s+(.+)$/.exec(heading.trim());
  return match?.[1] && match[2] ? { level: match[1].length, text: match[2].trim() } : { level: 2, text: heading.trim() };
}

/** Body line range [start, end) of the first heading with this text (any level), outside code. */
function findSection(lines: string[], text: string): { start: number; end: number } | null {
  let fence: string | null = null;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const match = HEADING_LINE.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    if (start === -1 && match[2].trim().toLowerCase() === text.toLowerCase()) {
      start = i;
      level = match[1].length;
    } else if (start !== -1 && match[1].length <= level) {
      return { start, end: i };
    }
  }
  return start === -1 ? null : { start, end: lines.length };
}

function alreadyLinked(content: string, link: string): boolean {
  const escaped = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[\\[${escaped}(?:[#|\\]]|\\\\\\|)`, 'i').test(content);
}
