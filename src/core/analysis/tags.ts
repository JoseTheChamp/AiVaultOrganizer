import type { NoteRecord } from '../model/note';

export interface TagUsage {
  tag: string;
  count: number;
}

export interface TagVariantGroup {
  /** Normalized key shared by all variants. */
  key: string;
  /** Spellings of the same tag, most used first. */
  variants: TagUsage[];
}

export interface TagStats {
  uniqueTags: number;
  /** Every tag spelling with the number of notes using it, most used first. */
  usage: TagUsage[];
  /** Groups of spellings that differ only in case, separators or diacritics. */
  variantGroups: TagVariantGroup[];
}

/**
 * Key under which tag spellings count as the same tag: lowercase, diacritics removed (Czech
 * vaults often mix `zdraví` and `zdravi`), and `-`, `_` and spaces dropped within each segment
 * (`ProjectManagement`, `project-management`, `project_management`). Nesting is kept.
 */
export function tagVariantKey(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .split('/')
    .map((segment) => segment.replace(/[-_\s]/g, ''))
    .join('/');
}

export function computeTagStats(notes: readonly NoteRecord[]): TagStats {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of new Set(note.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const usage = [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  const groups = new Map<string, TagUsage[]>();
  for (const entry of usage) {
    const key = tagVariantKey(entry.tag);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const variantGroups = [...groups]
    .filter(([, variants]) => variants.length > 1)
    .map(([key, variants]) => ({ key, variants }))
    .sort((a, b) => sum(b.variants) - sum(a.variants) || a.key.localeCompare(b.key));

  return { uniqueTags: counts.size, usage, variantGroups };
}

function sum(variants: TagUsage[]): number {
  return variants.reduce((total, variant) => total + variant.count, 0);
}
