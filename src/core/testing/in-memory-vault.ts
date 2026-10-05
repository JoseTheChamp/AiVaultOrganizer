import { webCryptoHasher } from '../hash';
import type { VaultSnapshot } from '../model/note';
import { ancestorFolders, normalizeVaultPath } from '../model/paths';
import type { Clock, Hasher, SnapshotOptions, VaultReader } from '../ports';
import { buildSnapshot } from '../snapshot/build-snapshot';

interface StoredFile {
  content: string;
  mtime: number;
  ctime: number;
}

export interface InMemoryVaultOptions {
  /** Folders that exist even when empty. */
  folders?: string[];
  clock?: Clock;
  hasher?: Hasher;
}

/** A vault held in memory. Used by unit tests and property-based tests of the core. */
export class InMemoryVault implements VaultReader {
  protected readonly files = new Map<string, StoredFile>();
  protected readonly folders = new Set<string>();
  protected readonly clock: Clock;
  protected readonly hasher: Hasher;

  constructor(options: InMemoryVaultOptions = {}) {
    let tick = 1_700_000_000_000;
    this.clock = options.clock ?? { now: () => (tick += 1000) };
    this.hasher = options.hasher ?? webCryptoHasher;
    for (const folder of options.folders ?? []) this.addFolder(folder);
  }

  static from(files: Record<string, string>, options: InMemoryVaultOptions = {}): InMemoryVault {
    const vault = new InMemoryVault(options);
    for (const [path, content] of Object.entries(files)) vault.setFile(path, content);
    return vault;
  }

  /** Test helper: creates or overwrites a file without going through the writer port. */
  setFile(path: string, content: string): void {
    const normalized = normalizeVaultPath(path);
    const now = this.clock.now();
    const existing = this.files.get(normalized);
    this.files.set(normalized, { content, mtime: now, ctime: existing?.ctime ?? now });
    for (const folder of ancestorFolders(normalized)) this.folders.add(folder);
  }

  addFolder(path: string): void {
    const normalized = normalizeVaultPath(path);
    if (normalized === '') return;
    this.folders.add(normalized);
    for (const folder of ancestorFolders(normalized)) this.folders.add(folder);
  }

  async snapshot(options: SnapshotOptions = {}): Promise<VaultSnapshot> {
    return buildSnapshot({
      files: [...this.files].map(([path, file]) => ({
        path,
        mtime: file.mtime,
        ctime: file.ctime,
        size: new TextEncoder().encode(file.content).length,
        content: file.content,
      })),
      folders: [...this.folders],
      ignore: options.ignore ?? [],
      hasher: this.hasher,
      now: this.clock.now(),
    });
  }

  async read(path: string): Promise<string> {
    const file = this.files.get(normalizeVaultPath(path));
    if (!file) throw new Error(`No such file: ${path}`);
    return file.content;
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizeVaultPath(path);
    return this.files.has(normalized) || this.folders.has(normalized);
  }

  /** All file paths, sorted; handy for assertions. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  folderPaths(): string[] {
    return [...this.folders].sort();
  }
}
