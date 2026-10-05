import { parseNote } from '../markdown/parse-note';
import { matchesAnyGlob } from '../model/glob';
import type { NoteRecord, OtherFile, VaultSnapshot } from '../model/note';
import { ancestorFolders, baseName, extension, parentFolder } from '../model/paths';
import type { Hasher } from '../ports';
import { LinkResolver } from './link-resolver';

/** A file as listed by an adapter that has no metadata cache (filesystem, in-memory). */
export interface RawFile {
  path: string;
  mtime: number;
  ctime: number;
  size: number;
  /** Raw text; required for Markdown files, ignored for others. */
  content?: string;
}

export interface BuildSnapshotInput {
  files: readonly RawFile[];
  /** Folders known to exist (empty folders cannot be derived from files). */
  folders: readonly string[];
  ignore?: readonly string[];
  hasher: Hasher;
  now: number;
}

/** True for paths Obsidian never indexes: any segment starting with a dot (`.obsidian`, `.trash`, …). */
export function isHiddenPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

/**
 * Builds a snapshot from raw files by parsing Markdown and resolving links in-process.
 * The Obsidian adapter does not use this; it reads the same facts from the metadata cache.
 */
export async function buildSnapshot(input: BuildSnapshotInput): Promise<VaultSnapshot> {
  const ignore = input.ignore ?? [];
  const visible = input.files.filter((file) => !isHiddenPath(file.path));
  const resolver = new LinkResolver(visible.map((file) => file.path));

  const markdown = visible.filter((file) => extension(file.path) === 'md' && !matchesAnyGlob(file.path, ignore));
  const included = new Set(markdown.map((file) => file.path));

  const notes: NoteRecord[] = [];
  const inLinks = new Map<string, Set<string>>();
  for (const file of markdown) {
    const content = file.content ?? '';
    const parsed = parseNote(content);
    const outLinks = new Set<string>();
    const unresolved = new Set<string>();
    for (const link of parsed.links) {
      const resolved = resolver.resolve(link.target, file.path);
      if (resolved === null) unresolved.add(link.target);
      else if (included.has(resolved) && resolved !== file.path) outLinks.add(resolved);
    }
    for (const target of outLinks) {
      const sources = inLinks.get(target) ?? new Set<string>();
      sources.add(file.path);
      inLinks.set(target, sources);
    }
    notes.push({
      path: file.path,
      basename: baseName(file.path),
      folder: parentFolder(file.path),
      mtime: file.mtime,
      ctime: file.ctime,
      size: file.size,
      contentHash: await input.hasher.sha256(content),
      frontmatter: parsed.frontmatter,
      tags: parsed.tags,
      headings: parsed.headings,
      outLinks: [...outLinks].sort(),
      unresolvedLinks: [...unresolved].sort(),
      inLinks: [],
      wordCount: parsed.wordCount,
    });
  }
  for (const note of notes) {
    note.inLinks = [...(inLinks.get(note.path) ?? [])].sort();
  }

  const folders = new Set<string>();
  for (const folder of input.folders) {
    if (folder !== '' && !isHiddenPath(folder)) folders.add(folder);
  }
  for (const file of visible) {
    for (const folder of ancestorFolders(file.path)) folders.add(folder);
  }

  const otherFiles: OtherFile[] = visible
    .filter((file) => extension(file.path) !== 'md' && !matchesAnyGlob(file.path, ignore))
    .map((file) => ({ path: file.path, extension: extension(file.path), size: file.size }));

  return {
    notes: notes.sort((a, b) => compare(a.path, b.path)),
    folders: [...folders].sort(compare),
    otherFiles: otherFiles.sort((a, b) => compare(a.path, b.path)),
    takenAt: input.now,
  };
}

/** Locale-independent ordering so snapshots are identical on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
