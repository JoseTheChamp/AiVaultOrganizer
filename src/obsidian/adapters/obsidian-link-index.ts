import { type App, normalizePath } from 'obsidian';
import type { LinkGraph, LinkIndex } from '../../core/ports';

/** LinkIndex over Obsidian's metadata cache (resolvedLinks / unresolvedLinks). */
export class ObsidianLinkIndex implements LinkIndex {
  constructor(private readonly app: App) {}

  async backlinks(path: string): Promise<string[]> {
    const target = normalizePath(path);
    const sources: string[] = [];
    for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (source !== target && targets[target] !== undefined) sources.push(source);
    }
    return sources.sort();
  }

  async outgoing(path: string): Promise<string[]> {
    const source = normalizePath(path);
    return Object.keys(this.app.metadataCache.resolvedLinks[source] ?? {})
      .filter((target) => target !== source)
      .sort();
  }

  async linkText(targetPath: string, sourcePath: string): Promise<string> {
    const file = this.app.vault.getFileByPath(normalizePath(targetPath));
    if (!file) throw new Error(`No such file: ${targetPath}`);
    return this.app.metadataCache.fileToLinktext(file, normalizePath(sourcePath), true);
  }

  async graph(): Promise<LinkGraph> {
    const edges: Array<[string, string]> = [];
    for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      for (const target of Object.keys(targets)) if (target !== source) edges.push([source, target]);
    }
    let unresolvedCount = 0;
    for (const targets of Object.values(this.app.metadataCache.unresolvedLinks)) unresolvedCount += Object.keys(targets).length;
    return { edges, unresolvedCount };
  }
}
