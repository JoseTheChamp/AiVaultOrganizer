import { err, ok, type Result } from '../model/result';

/**
 * Generated sections are regions of a note the plugin owns, wrapped in HTML comments:
 *
 *   <!-- charter:generated:start id="overview" -->
 *   …generated Markdown…
 *   <!-- charter:generated:end -->
 *
 * Everything outside the markers belongs to the user and is never rewritten (PLAN §3.1).
 */

export function sectionStart(id: string, namespace = 'charter'): string {
  return `<!-- ${namespace}:generated:start id="${id}" -->`;
}

export function sectionEnd(namespace = 'charter'): string {
  return `<!-- ${namespace}:generated:end -->`;
}

export function wrapGeneratedSection(id: string, inner: string, namespace = 'charter'): string {
  return `${sectionStart(id, namespace)}\n${inner.trim()}\n${sectionEnd(namespace)}`;
}

export interface GeneratedSection {
  id: string;
  inner: string;
}

export function listGeneratedSections(content: string, namespace = 'charter'): GeneratedSection[] {
  const pattern = new RegExp(
    `<!-- ${namespace}:generated:start id="([^"]+)" -->\\r?\\n?([\\s\\S]*?)\\r?\\n?<!-- ${namespace}:generated:end -->`,
    'g',
  );
  return [...content.matchAll(pattern)].map((match) => ({ id: match[1] ?? '', inner: match[2] ?? '' }));
}

export type SectionError = 'missing' | 'malformed';

/** Replaces the inner Markdown of one generated section; fails instead of guessing where it went. */
export function replaceGeneratedSection(
  content: string,
  id: string,
  inner: string,
  namespace = 'charter',
): Result<string, SectionError> {
  const start = sectionStart(id, namespace);
  const startIndex = content.indexOf(start);
  if (startIndex === -1) return err('missing');
  if (content.indexOf(start, startIndex + start.length) !== -1) return err('malformed');
  const endIndex = content.indexOf(sectionEnd(namespace), startIndex + start.length);
  if (endIndex === -1) return err('malformed');
  const nextStart = content.indexOf(`<!-- ${namespace}:generated:start`, startIndex + start.length);
  if (nextStart !== -1 && nextStart < endIndex) return err('malformed');
  return ok(`${content.slice(0, startIndex)}${start}\n${inner.trim()}\n${content.slice(endIndex)}`);
}
