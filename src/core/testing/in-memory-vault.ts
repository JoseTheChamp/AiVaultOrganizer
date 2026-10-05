import { webCryptoHasher } from '../hash';
import { rewriteFrontmatter } from '../markdown/frontmatter-edit';
import type { VaultSnapshot } from '../model/note';
import { ancestorFolders, extension, isInFolder, normalizeVaultPath, parentFolder } from '../model/paths';
import type { Clock, Hasher, LinkGraph, LinkIndex, SnapshotOptions, VaultReader, VaultWriter } from '../ports';
import { buildSnapshot } from '../snapshot/build-snapshot';
import { ComputedLinkIndex, linkUpdatesForMove } from '../snapshot/link-graph';

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

/**
 * A vault held in memory, implementing every vault port. Writes behave like Obsidian's APIs:
 * moves update links in other notes, frontmatter edits re-serialize YAML, trashing removes the file
 * into an inspectable trash. Used by unit and property-based tests of the core.
 */
export class InMemoryVault implements VaultReader, VaultWriter, LinkIndex {
  protected readonly files = new Map<string, StoredFile>();
  protected readonly folders = new Set<string>();
  protected readonly clock: Clock;
  protected readonly hasher: Hasher;
  /** Files sent to the trash by `trashPluginCreated`, with their last content. */
  readonly trash: { path: string; content: string }[] = [];
  /** When set, the next write to this path throws (to test failure handling). */
  failNextWriteTo: string | null = null;
  private index: ComputedLinkIndex | null = null;

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

  // ── Test helpers ────────────────────────────────────────────────────────────

  /** Creates or overwrites a file without going through the writer port (simulates the user). */
  setFile(path: string, content: string): void {
    const normalized = normalizeVaultPath(path);
    const now = this.clock.now();
    const existing = this.files.get(normalized);
    this.files.set(normalized, { content, mtime: now, ctime: existing?.ctime ?? now });
    for (const folder of ancestorFolders(normalized)) this.folders.add(folder);
    this.index = null;
  }

  addFolder(path: string): void {
    const normalized = normalizeVaultPath(path);
    if (normalized === '') return;
    this.folders.add(normalized);
    for (const folder of ancestorFolders(normalized)) this.folders.add(folder);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  folderPaths(): string[] {
    return [...this.folders].sort();
  }

  /** Path → content of every file; compare two of these to prove byte-identical state. */
  contents(): Record<string, string> {
    return Object.fromEntries([...this.files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, f]) => [p, f.content]));
  }

  // ── VaultReader ─────────────────────────────────────────────────────────────

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
    return this.require(path).content;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return new TextEncoder().encode(this.require(path).content);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizeVaultPath(path);
    return this.files.has(normalized) || this.folders.has(normalized);
  }

  // ── VaultWriter ─────────────────────────────────────────────────────────────

  async createFolder(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    if (this.folders.has(normalized) || this.files.has(normalized)) throw new Error(`Already exists: ${path}`);
    this.addFolder(normalized);
  }

  async move(from: string, to: string): Promise<void> {
    this.checkFailure(from);
    const source = this.require(from);
    if (this.files.has(to) && from.toLowerCase() !== to.toLowerCase()) throw new Error(`Already exists: ${to}`);
    const parent = parentFolder(to);
    if (parent !== '' && !this.folders.has(parent)) throw new Error(`No such folder: ${parent}`);

    const notes = [...this.files]
      .filter(([path]) => extension(path) === 'md')
      .map(([path, file]) => ({ path, content: file.content }));
    const updates = linkUpdatesForMove(notes, [...this.files.keys()], from, to);
    this.files.delete(from);
    this.files.set(to, { ...source, mtime: this.clock.now() });
    for (const [path, content] of updates) {
      const file = this.files.get(path);
      if (file) this.files.set(path, { ...file, content, mtime: this.clock.now() });
    }
    this.index = null;
  }

  async processFrontmatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> {
    await this.processBody(path, (content) => rewriteFrontmatter(content, fn));
  }

  async processBody(path: string, fn: (content: string) => string): Promise<void> {
    this.checkFailure(path);
    const file = this.require(path);
    const next = fn(file.content);
    if (next !== file.content) this.files.set(path, { ...file, content: next, mtime: this.clock.now() });
    this.index = null;
  }

  async create(path: string, content: string): Promise<void> {
    this.checkFailure(path);
    if (this.files.has(path) || this.folders.has(path)) throw new Error(`Already exists: ${path}`);
    const parent = parentFolder(path);
    if (parent !== '' && !this.folders.has(parent)) throw new Error(`No such folder: ${parent}`);
    const now = this.clock.now();
    this.files.set(path, { content, mtime: now, ctime: now });
    this.index = null;
  }

  async trashPluginCreated(path: string): Promise<void> {
    const file = this.require(path);
    this.files.delete(path);
    this.trash.push({ path, content: file.content });
    this.index = null;
  }

  async removeEmptyFolder(path: string): Promise<boolean> {
    const busy =
      [...this.files.keys()].some((file) => isInFolder(file, path)) ||
      [...this.folders].some((folder) => folder !== path && isInFolder(folder, path));
    if (busy || !this.folders.has(path)) return false;
    this.folders.delete(path);
    return true;
  }

  async waitForIndex(): Promise<void> {
    // Writes are synchronous in memory; the index is rebuilt lazily.
  }

  // ── LinkIndex ───────────────────────────────────────────────────────────────

  async backlinks(path: string): Promise<string[]> {
    return this.linkIndex().backlinks(path);
  }

  async outgoing(path: string): Promise<string[]> {
    return this.linkIndex().outgoing(path);
  }

  async linkText(targetPath: string): Promise<string> {
    return this.linkIndex().linkText(targetPath);
  }

  async graph(): Promise<LinkGraph> {
    return this.linkIndex().graph();
  }

  private linkIndex(): ComputedLinkIndex {
    this.index ??= new ComputedLinkIndex(
      [...this.files].filter(([path]) => extension(path) === 'md').map(([path, file]) => ({ path, content: file.content })),
      [...this.files.keys()],
    );
    return this.index;
  }

  private require(path: string): StoredFile {
    const file = this.files.get(normalizeVaultPath(path));
    if (!file) throw new Error(`No such file: ${path}`);
    return file;
  }

  private checkFailure(path: string): void {
    if (this.failNextWriteTo === path) {
      this.failNextWriteTo = null;
      throw new Error(`Simulated write failure: ${path}`);
    }
  }
}
