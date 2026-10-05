import { parseNote } from '../markdown/parse-note';
import { rewriteLinks } from '../markdown/rewrite-links';
import { baseName, extension, fileName } from '../model/paths';
import type { LinkGraph } from '../ports';
import { isHiddenPath } from './build-snapshot';
import { LinkResolver } from './link-resolver';

export interface TextFile {
  path: string;
  content: string;
}

/**
 * Resolved link index computed from file contents, for adapters without Obsidian's metadata
 * cache. `notes` are Markdown files with content; `allPaths` lists every file (attachments too)
 * so links to them resolve.
 */
export class ComputedLinkIndex {
  private readonly outgoingMap = new Map<string, Set<string>>();
  private readonly incomingMap = new Map<string, Set<string>>();
  private unresolved = 0;

  constructor(
    notes: readonly TextFile[],
    private readonly allPaths: readonly string[],
  ) {
    const resolver = new LinkResolver(allPaths.filter((p) => !isHiddenPath(p)));
    for (const note of notes) {
      if (isHiddenPath(note.path)) continue;
      const targets = new Set<string>();
      const missing = new Set<string>();
      for (const link of parseNote(note.content).links) {
        const resolved = resolver.resolve(link.target, note.path);
        if (resolved === null) missing.add(link.target);
        else if (resolved !== note.path) targets.add(resolved);
      }
      this.unresolved += missing.size;
      this.outgoingMap.set(note.path, targets);
      for (const target of targets) {
        const sources = this.incomingMap.get(target) ?? new Set<string>();
        sources.add(note.path);
        this.incomingMap.set(target, sources);
      }
    }
  }

  backlinks(path: string): string[] {
    return [...(this.incomingMap.get(path) ?? [])].sort();
  }

  outgoing(path: string): string[] {
    return [...(this.outgoingMap.get(path) ?? [])].sort();
  }

  graph(): LinkGraph {
    const edges: Array<[string, string]> = [];
    for (const [source, targets] of this.outgoingMap) for (const target of targets) edges.push([source, target]);
    return { edges, unresolvedCount: this.unresolved };
  }

  /** "Shortest path when possible", Obsidian's default new-link format. */
  linkText(targetPath: string): string {
    return shortestLinkText(targetPath, this.allPaths);
  }
}

export function shortestLinkText(targetPath: string, allPaths: readonly string[]): string {
  const name = fileName(targetPath).toLowerCase();
  const unique = allPaths.filter((p) => fileName(p).toLowerCase() === name).length <= 1;
  const isNote = extension(targetPath) === 'md';
  if (unique) return isNote ? baseName(targetPath) : fileName(targetPath);
  return isNote ? targetPath.slice(0, -'.md'.length) : targetPath;
}

/**
 * Contents that change when a file moves from `from` to `to`, imitating Obsidian's "automatically
 * update internal links": links to the moved file that would no longer resolve to it are rewritten,
 * as are the moved note's own links whose resolution depends on its folder. Returns new contents
 * keyed by the files' paths after the move.
 */
export function linkUpdatesForMove(
  notes: readonly TextFile[],
  allPaths: readonly string[],
  from: string,
  to: string,
): Map<string, string> {
  const before = new LinkResolver(allPaths);
  const afterPaths = allPaths.map((p) => (p === from ? to : p));
  const after = new LinkResolver(afterPaths);
  const updates = new Map<string, string>();

  for (const note of notes) {
    const sourceBefore = note.path;
    const sourceAfter = note.path === from ? to : note.path;
    const updated = rewriteLinks(note.content, (link) => {
      const intended = before.resolve(link.target, sourceBefore);
      if (intended === null) return null;
      const intendedAfter = intended === from ? to : intended;
      if (intended !== from && note.path !== from) return null;
      if (after.resolve(link.target, sourceAfter) === intendedAfter) return null;
      if (link.kind === 'markdown') return intendedAfter;
      return shortestLinkText(intendedAfter, afterPaths);
    });
    if (updated !== note.content) updates.set(sourceAfter, updated);
  }
  return updates;
}
