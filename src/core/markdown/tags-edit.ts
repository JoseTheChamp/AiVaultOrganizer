import { splitFrontmatter } from './frontmatter';
import { normalizeTag } from './parse-note';
import { mapProse } from './prose';

/** The frontmatter key holding tags (`tags` in any case); defaults to `tags` when absent. */
export function tagsKey(frontmatter: Record<string, unknown>): string {
  return Object.keys(frontmatter).find((key) => /^tags$/i.test(key)) ?? 'tags';
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? [...(value as unknown[])] : [value];
}

const sameTag = (a: unknown, b: string) => typeof a === 'string' && normalizeTag(a).toLowerCase() === b.toLowerCase();

/**
 * Adds tags to the frontmatter list, skipping any already present in any casing. A single string
 * value becomes a list with that string first. Returns the tags actually added.
 */
export function addTagsToFrontmatter(frontmatter: Record<string, unknown>, tags: readonly string[]): string[] {
  const key = tagsKey(frontmatter);
  const list = asList(frontmatter[key]);
  const added: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag === '' || list.some((existing) => sameTag(existing, tag))) continue;
    list.push(tag);
    added.push(tag);
  }
  if (added.length > 0) frontmatter[key] = list;
  return added;
}

/** Renames a tag (and its nested children, `from/x` → `to/x`) in the frontmatter list. */
export function replaceTagInFrontmatter(frontmatter: Record<string, unknown>, from: string, to: string): boolean {
  const key = tagsKey(frontmatter);
  if (!(key in frontmatter)) return false;
  const source = normalizeTag(from);
  const target = normalizeTag(to);
  let changed = false;
  const renamed = asList(frontmatter[key]).map((value) => {
    if (typeof value !== 'string') return value;
    const tag = normalizeTag(value);
    if (tag === source || tag.startsWith(`${source}/`)) {
      changed = true;
      return target + tag.slice(source.length);
    }
    return value;
  });
  if (!changed) return false;
  // Renaming a variant onto an existing spelling must not leave duplicates.
  frontmatter[key] = renamed.filter((value, index) => typeof value !== 'string' || renamed.indexOf(value) === index);
  return true;
}

/**
 * Renames inline `#from` tags (and nested `#from/child`) in the body, outside code. The match is
 * exact on the spelling, so `#ProjectX` → `#project-x` leaves `#projectx` alone.
 */
export function replaceInlineTag(content: string, from: string, to: string): string {
  const { body } = splitFrontmatter(content);
  const head = content.slice(0, content.length - body.length);
  const source = escapeRegExp(normalizeTag(from));
  const pattern = new RegExp(`(^|\\s)#${source}(?![\\p{L}\\p{N}_\\-])`, 'gu');
  const target = normalizeTag(to);
  return head + mapProse(body, (segment) => segment.replace(pattern, (_match, lead: string) => `${lead}#${target}`));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
