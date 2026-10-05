import { parse } from 'yaml';

export interface FrontmatterSplit {
  /** Raw YAML between the `---` fences, or null when the note has no frontmatter. */
  yaml: string | null;
  /** Everything after the closing fence (or the whole content without frontmatter). */
  body: string;
}

/**
 * Splits YAML frontmatter from the body. Like Obsidian, frontmatter must start on the very first
 * line with `---` and end with a line that is exactly `---`.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const opening = /^---[ \t]*\r?\n/.exec(content);
  if (!opening) return { yaml: null, body: content };
  const rest = content.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return { yaml: null, body: content };
  return {
    yaml: rest.slice(0, closing.index),
    body: rest.slice(closing.index + closing[0].length),
  };
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  /** False when a frontmatter block exists but is not a valid YAML mapping. */
  valid: boolean;
  body: string;
}

/**
 * Parses frontmatter with the YAML 1.2 core schema: no implicit dates, so `created: 2024-01-31`
 * stays a string exactly as Obsidian's metadata cache reports it.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const { yaml, body } = splitFrontmatter(content);
  if (yaml === null) return { data: {}, valid: true, body };
  if (yaml.trim() === '') return { data: {}, valid: true, body };
  try {
    const data: unknown = parse(yaml, { schema: 'core' });
    if (data === null || data === undefined) return { data: {}, valid: true, body };
    if (typeof data !== 'object' || Array.isArray(data)) return { data: {}, valid: false, body };
    return { data: data as Record<string, unknown>, valid: true, body };
  } catch {
    return { data: {}, valid: false, body };
  }
}
