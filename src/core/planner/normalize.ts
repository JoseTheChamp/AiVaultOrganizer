import { computeTagStats, tagVariantKey } from '../analysis/tags';
import type { Charter } from '../charter/schema';
import type { NoteRecord } from '../model/note';
import { createOperation, type Operation } from '../model/operation';

/** Property names with a widely agreed spelling (Obsidian core and common plugins). */
const KNOWN_KEYS = ['type', 'status', 'tags', 'categories', 'created', 'source', 'aliases', 'author', 'date'];
/** Other names people use for the same property. */
const SYNONYMS: Record<string, string> = { kind: 'type', tag: 'tags', alias: 'aliases', category: 'categories' };

const meta = (note: NoteRecord, rationale: string) => ({
  source: 'rule' as const,
  confidence: 1,
  rationale,
  precondition: { path: note.path, contentHash: note.contentHash },
});

/**
 * Consistent property names and values (PLAN §3.2 conventions): a key spelled differently from
 * its canonical form (`Type`, `kind`) is renamed, never duplicated or overwritten; an enum value
 * in the wrong case (`Project`) is corrected to the charter's spelling; and a required `created`
 * property is filled from the file's creation date. Keys that would collide are left alone.
 */
export function propertyOperations(notes: readonly NoteRecord[], charter: Charter): Operation[] {
  const conventions = charter.conventions.properties;
  const enums = conventions?.enums ?? {};
  const canonical = new Map<string, string>();
  for (const key of [...KNOWN_KEYS, ...(conventions?.required ?? []), ...Object.keys(enums)]) canonical.set(key.toLowerCase(), key);

  const operations: Operation[] = [];
  for (const note of notes) {
    const keys = Object.keys(note.frontmatter);
    const renamed = new Map<string, { from: string; opId: string }>();
    for (const key of keys) {
      const lower = key.toLowerCase();
      const target = canonical.get(lower) ?? canonical.get(SYNONYMS[lower] ?? '') ?? SYNONYMS[lower];
      if (!target || target === key || keys.includes(target) || renamed.has(target)) continue;
      const op = createOperation({ kind: 'renameProperty', path: note.path, from: key, to: target }, meta(note, `The charter spells this property "${target}".`));
      operations.push(op);
      renamed.set(target, { from: key, opId: op.id });
    }
    for (const [key, values] of Object.entries(enums)) {
      const rename = renamed.get(key);
      const value = note.frontmatter[rename?.from ?? key];
      if (typeof value !== 'string') continue;
      const match = values.find((allowed) => String(allowed).toLowerCase() === value.toLowerCase());
      if (match === undefined || String(match) === value) continue;
      operations.push(
        createOperation(
          { kind: 'setProperty', path: note.path, key, value: match },
          { ...meta(note, `The charter writes "${key}" as "${String(match)}".`), ...(rename ? { dependsOn: [rename.opId] } : {}) },
        ),
      );
    }
    if (conventions?.required.includes('created') && !keys.some((key) => key.toLowerCase() === 'created') && !renamed.has('created')) {
      const created = new Date(note.ctime).toISOString().slice(0, 10);
      operations.push(createOperation({ kind: 'setProperty', path: note.path, key: 'created', value: created }, meta(note, 'The charter requires a creation date; taken from the file.')));
    }
  }
  return operations;
}

/** `Project Management` → `project-management`, per segment of a nested tag. */
export function kebabTag(tag: string): string {
  return tag
    .split('/')
    .map((segment) => segment.normalize('NFC').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-'))
    .join('/');
}

/**
 * One spelling per tag (PLAN §3.2 `conventions.tags`): spellings that differ only in case,
 * diacritics or separators are merged into the most used one, the charter's explicit canonical
 * map wins over that, and the `lowercase-kebab` style is applied on top. Each change is a
 * `replaceTag`, which rewrites the tag in properties and in the text alike.
 */
export function tagOperations(notes: readonly NoteRecord[], charter: Charter): Operation[] {
  const conventions = charter.conventions.tags;
  const explicit = new Map(Object.entries(conventions?.canonical ?? {}).map(([from, to]) => [from.toLowerCase(), to]));
  const groups = new Map(computeTagStats(notes).variantGroups.map((group) => [group.key, group.variants[0]?.tag]));
  const style = (tag: string): string => (conventions?.style === 'lowercase-kebab' ? kebabTag(tag) : tag);
  const canonicalOf = (tag: string): string => style(explicit.get(tag.toLowerCase()) ?? groups.get(tagVariantKey(tag)) ?? tag);

  const operations: Operation[] = [];
  for (const note of notes) {
    const done = new Set<string>();
    for (const tag of note.tags) {
      const target = canonicalOf(tag);
      if (target === tag || done.has(tag)) continue;
      done.add(tag);
      operations.push(createOperation({ kind: 'replaceTag', path: note.path, from: tag, to: target }, meta(note, `One spelling for this tag across the vault: #${target}.`)));
    }
  }
  return operations;
}
