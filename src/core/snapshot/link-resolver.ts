import { extension, joinPath, normalizeVaultPath, parentFolder } from '../model/paths';

/**
 * Resolves link paths to files the way Obsidian's `getFirstLinkpathDest` does, closely enough for
 * analysis: case-insensitive; a path is tried from the vault root, then relative to the source
 * note; a bare name matches any file with that name, preferring the source's folder, then the
 * shortest path. Links without an extension refer to Markdown notes.
 */
export class LinkResolver {
  private readonly byLowerPath = new Map<string, string>();
  private readonly byLowerName = new Map<string, string[]>();

  constructor(filePaths: Iterable<string>) {
    for (const path of filePaths) {
      const lower = path.toLowerCase();
      this.byLowerPath.set(lower, path);
      const name = lower.slice(lower.lastIndexOf('/') + 1);
      const list = this.byLowerName.get(name);
      if (list) list.push(path);
      else this.byLowerName.set(name, [path]);
    }
  }

  resolve(linkpath: string, sourcePath: string): string | null {
    const cleaned = normalizeVaultPath(linkpath);
    if (cleaned === '') return null;
    const candidates = extension(cleaned) === '' || !this.hasKnownFile(cleaned) ? [`${cleaned}.md`, cleaned] : [cleaned];

    for (const candidate of candidates) {
      const fromRoot = this.byLowerPath.get(candidate.toLowerCase());
      if (fromRoot) return fromRoot;
    }
    // Relative paths are joined before normalizing so that `../` climbs out of the source folder.
    const sourceFolder = parentFolder(sourcePath);
    for (const candidate of candidates) {
      const raw = candidate === cleaned ? linkpath : `${linkpath}.md`;
      const relative = this.byLowerPath.get(joinPath(sourceFolder, raw).toLowerCase());
      if (relative) return relative;
    }
    for (const candidate of candidates) {
      const match = this.bySuffix(candidate, sourceFolder);
      if (match) return match;
    }
    return null;
  }

  private hasKnownFile(path: string): boolean {
    const lower = path.toLowerCase();
    return this.byLowerPath.has(lower) || this.byLowerName.has(lower.slice(lower.lastIndexOf('/') + 1));
  }

  private bySuffix(candidate: string, sourceFolder: string): string | null {
    const lower = candidate.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    const matches = (this.byLowerName.get(name) ?? []).filter((path) => {
      const lowerPath = path.toLowerCase();
      return lowerPath === lower || lowerPath.endsWith(`/${lower}`);
    });
    if (matches.length === 0) return null;
    const sameFolder = matches.find((path) => parentFolder(path) === sourceFolder);
    if (sameFolder) return sameFolder;
    return [...matches].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
  }
}
