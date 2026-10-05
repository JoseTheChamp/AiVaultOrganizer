/**
 * Runtime stand-in for the `obsidian` module in Vitest (the npm package ships types only).
 * Aliased in vitest.config.ts. Implements just enough for adapter tests; behavior that matters
 * (link resolution, tag extraction) comes from recorded metadata caches, not from this file.
 */

export interface FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export abstract class TAbstractFile {
  name: string;
  parent: TFolder | null = null;

  constructor(public path: string) {
    this.name = path.slice(path.lastIndexOf('/') + 1);
  }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;

  constructor(
    path: string,
    public stat: FileStats,
  ) {
    super(path);
    const dot = this.name.lastIndexOf('.');
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : '';
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === '/';
  }
}

export function normalizePath(path: string): string {
  const cleaned = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
  return cleaned === '' ? '/' : cleaned.normalize('NFC');
}

interface TagCacheLike {
  tag: string;
}

interface CachedMetadataLike {
  frontmatter?: Record<string, unknown>;
  tags?: TagCacheLike[];
}

/**
 * Mirrors Obsidian 1.13's getAllTags as observed in fixtures/contract/tag-probes: frontmatter tags
 * (key `tags` in any case, strings without whitespace, never split) first, then inline tags, all
 * with `#`. The contract test checks this shim against what real Obsidian returned.
 */
export function getAllTags(cache: CachedMetadataLike): string[] | null {
  const result: string[] = [];
  for (const [key, value] of Object.entries(cache.frontmatter ?? {})) {
    if (!/^tags$/i.test(key)) continue;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== 'string' || item.trim() === '' || /\s/.test(item.trim())) continue;
      result.push(`#${item.trim().replace(/^#+/, '')}`);
    }
  }
  for (const tag of cache.tags ?? []) result.push(tag.tag);
  return result;
}
