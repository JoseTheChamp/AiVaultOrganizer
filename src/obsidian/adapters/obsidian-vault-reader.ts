import { type App, getAllTags, normalizePath, type TFile, TFolder } from 'obsidian';
import { countWords } from '../../core/markdown/parse-note';
import { matchesAnyGlob } from '../../core/model/glob';
import type { NoteRecord, OtherFile, VaultSnapshot } from '../../core/model/note';
import { isHiddenPath } from '../../core/snapshot/build-snapshot';
import type { Clock, Hasher, SnapshotOptions, VaultReader } from '../../core/ports';

/**
 * Builds the vault snapshot from Obsidian's metadata cache instead of parsing notes ourselves,
 * so link resolution and tags are exactly what the user sees in Obsidian. File contents are only
 * read (from Obsidian's cache) to compute content hashes and word counts.
 */
export class ObsidianVaultReader implements VaultReader {
  constructor(
    private readonly app: App,
    private readonly hasher: Hasher,
    private readonly clock: Clock,
  ) {}

  async snapshot(options: SnapshotOptions = {}): Promise<VaultSnapshot> {
    const ignore = options.ignore ?? [];
    const { vault, metadataCache } = this.app;
    const visible = vault.getFiles().filter((file) => !isHiddenPath(file.path));
    const markdown = visible.filter((file) => file.extension === 'md' && !matchesAnyGlob(file.path, ignore));
    const included = new Set(markdown.map((file) => file.path));

    const notes: NoteRecord[] = [];
    const inLinks = new Map<string, Set<string>>();
    for (const file of markdown) {
      const cache = metadataCache.getFileCache(file);
      const content = await vault.cachedRead(file);
      const outLinks = Object.keys(metadataCache.resolvedLinks[file.path] ?? {})
        .filter((target) => included.has(target) && target !== file.path)
        .sort(compare);
      for (const target of outLinks) {
        const sources = inLinks.get(target) ?? new Set<string>();
        sources.add(file.path);
        inLinks.set(target, sources);
      }
      notes.push({
        path: file.path,
        basename: file.basename,
        folder: parentPath(file),
        mtime: file.stat.mtime,
        ctime: file.stat.ctime,
        size: file.stat.size,
        contentHash: await this.hasher.sha256(content),
        frontmatter: cache?.frontmatter ? { ...(cache.frontmatter as Record<string, unknown>) } : {},
        tags: cache ? [...new Set((getAllTags(cache) ?? []).map((tag) => tag.replace(/^#/, '')))] : [],
        headings: (cache?.headings ?? []).map((heading) => ({ level: heading.level, text: heading.heading })),
        outLinks,
        unresolvedLinks: Object.keys(metadataCache.unresolvedLinks[file.path] ?? {}).sort(compare),
        inLinks: [],
        wordCount: countWords(content),
      });
    }
    for (const note of notes) {
      note.inLinks = [...(inLinks.get(note.path) ?? [])].sort(compare);
    }

    const folders = vault
      .getAllLoadedFiles()
      .filter((item): item is TFolder => item instanceof TFolder && !item.isRoot() && !isHiddenPath(item.path))
      .map((folder) => folder.path)
      .sort(compare);

    const otherFiles: OtherFile[] = visible
      .filter((file) => file.extension !== 'md' && !matchesAnyGlob(file.path, ignore))
      .map((file) => ({ path: file.path, extension: file.extension.toLowerCase(), size: file.stat.size }))
      .sort((a, b) => compare(a.path, b.path));

    return {
      notes: notes.sort((a, b) => compare(a.path, b.path)),
      folders,
      otherFiles,
      takenAt: this.clock.now(),
    };
  }

  async read(path: string): Promise<string> {
    const file = this.app.vault.getFileByPath(normalizePath(path));
    if (!file) throw new Error(`No such file: ${path}`);
    return this.app.vault.cachedRead(file);
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }
}

function parentPath(file: TFile): string {
  const parent = file.parent;
  return !parent || parent.isRoot() ? '' : parent.path;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
