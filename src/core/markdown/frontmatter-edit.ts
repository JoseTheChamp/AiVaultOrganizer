import { parse, stringify } from 'yaml';
import { stableStringify } from '../model/stable-hash';
import { splitFrontmatter } from './frontmatter';

/**
 * Read-modify-write of a note's frontmatter for adapters without Obsidian's
 * `fileManager.processFrontMatter` (in-memory tests, Node evals). Same contract: `fn` mutates the
 * parsed object; the YAML is re-serialized only if something changed; invalid YAML throws rather
 * than being overwritten.
 */
export function rewriteFrontmatter(content: string, fn: (frontmatter: Record<string, unknown>) => void): string {
  const { yaml, body } = splitFrontmatter(content);
  let data: Record<string, unknown> = {};
  if (yaml !== null && yaml.trim() !== '') {
    const parsed: unknown = parse(yaml, { schema: 'core' });
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('Frontmatter is not a YAML mapping');
    }
    data = (parsed as Record<string, unknown> | null) ?? {};
  }
  const before = stableStringify(data);
  fn(data);
  if (stableStringify(data) === before) return content;
  const text = Object.keys(data).length > 0 ? stringify(data, { lineWidth: 0 }) : '';
  return `---\n${text}---\n${body}`;
}
