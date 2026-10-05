import type { App, CachedMetadata } from 'obsidian';
import type { VaultSnapshot } from '../../core/model/note';
// Construct the shim classes directly: at test runtime 'obsidian' resolves to the same module.
import { type TAbstractFile, TFile, TFolder } from './obsidian-shim';

/**
 * What Obsidian knew about a vault at one moment: file stats, the metadata cache per file and
 * the resolved/unresolved link maps. Produced in a real vault by scripts/record-obsidian-cache.js
 * and replayed in tests through `createFakeApp`.
 */
export interface RecordedVault {
  obsidianVersion?: string;
  recordedAt?: string;
  files: { path: string; stat: { ctime: number; mtime: number; size: number }; cache: CachedMetadata | null }[];
  folders: string[];
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;
  /** Snapshot the plugin's Obsidian adapter produced inside real Obsidian, if it was loaded. */
  observedSnapshot?: VaultSnapshot | null;
}

/** A fake App backed by a recorded vault and file contents. Only the APIs adapters use exist. */
export function createFakeApp(recorded: RecordedVault, contents: Record<string, string>): App {
  const root = new TFolder('/');
  const byPath = new Map<string, TAbstractFile>([['/', root]]);

  const folderFor = (path: string): TFolder => {
    if (path === '') return root;
    const existing = byPath.get(path);
    if (existing instanceof TFolder) return existing;
    const folder = new TFolder(path);
    const parent = folderFor(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    folder.parent = parent;
    parent.children.push(folder);
    byPath.set(path, folder);
    return folder;
  };

  for (const folder of recorded.folders) folderFor(folder);
  const caches = new Map<string, CachedMetadata | null>();
  for (const entry of recorded.files) {
    const file = new TFile(entry.path, entry.stat);
    const parent = folderFor(entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '');
    file.parent = parent;
    parent.children.push(file);
    byPath.set(entry.path, file);
    caches.set(entry.path, entry.cache);
  }

  const files = () => [...byPath.values()].filter((item): item is TFile => item instanceof TFile);
  const vault = {
    getFiles: () => files(),
    getMarkdownFiles: () => files().filter((file) => file.extension === 'md'),
    getAllLoadedFiles: () => [...byPath.values()],
    getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    getFileByPath: (path: string) => {
      const item = byPath.get(path);
      return item instanceof TFile ? item : null;
    },
    cachedRead: async (file: TFile) => contents[file.path] ?? '',
    read: async (file: TFile) => contents[file.path] ?? '',
  };
  const metadataCache = {
    getFileCache: (file: TFile) => caches.get(file.path) ?? null,
    resolvedLinks: recorded.resolvedLinks,
    unresolvedLinks: recorded.unresolvedLinks,
  };
  return { vault, metadataCache } as unknown as App;
}
