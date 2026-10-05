import { type App, normalizePath, type TFile, TFolder } from 'obsidian';
import type { VaultWriter } from '../../core/ports';

/** How long the index must stay quiet before we assume Obsidian finished re-resolving links. */
const QUIET_MS = 150;
/** Upper bound per wait, so a missing 'resolved' event can never hang a run. */
const MAX_WAIT_MS = 3000;

/**
 * The only class that writes to the vault (invariant 2), used exclusively by the apply executor and
 * undo. Every call maps to the Obsidian API the community guidelines require: moves through
 * `fileManager.renameFile` (updates links), frontmatter through `processFrontMatter`, bodies
 * through the atomic `vault.process`, removals only of plugin-created files through `trashFile`.
 */
export class ObsidianVaultWriter implements VaultWriter {
  constructor(private readonly app: App) {}

  async createFolder(path: string): Promise<void> {
    await this.app.vault.createFolder(normalizePath(path));
  }

  async move(from: string, to: string): Promise<void> {
    await this.app.fileManager.renameFile(this.file(from), normalizePath(to));
  }

  async processFrontmatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file(path), (frontmatter: Record<string, unknown>) => fn(frontmatter));
  }

  async processBody(path: string, fn: (content: string) => string): Promise<void> {
    await this.app.vault.process(this.file(path), fn);
  }

  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(normalizePath(path), content);
  }

  async trashPluginCreated(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.file(path));
  }

  async removeEmptyFolder(path: string): Promise<boolean> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(folder instanceof TFolder) || folder.children.length > 0) return false;
    await this.app.fileManager.trashFile(folder);
    return true;
  }

  /**
   * Resolves once the metadata cache is idle: on its 'resolved' event, or after a short quiet
   * period without 'changed' events (no change → nothing to resolve), or at the latest after
   * MAX_WAIT_MS.
   */
  waitForIndex(): Promise<void> {
    const cache = this.app.metadataCache;
    return new Promise((resolve) => {
      let quiet = window.setTimeout(finish, QUIET_MS);
      const cap = window.setTimeout(finish, MAX_WAIT_MS);
      const resolvedRef = cache.on('resolved', finish);
      const changedRef = cache.on('changed', () => {
        window.clearTimeout(quiet);
        quiet = window.setTimeout(finish, QUIET_MS);
      });
      function finish(): void {
        window.clearTimeout(quiet);
        window.clearTimeout(cap);
        cache.offref(resolvedRef);
        cache.offref(changedRef);
        resolve();
      }
    });
  }

  private file(path: string): TFile {
    const file = this.app.vault.getFileByPath(normalizePath(path));
    if (!file) throw new Error(`No such file: ${path}`);
    return file;
  }
}

/**
 * Obsidian's "Automatically update internal links" setting, read through the undocumented
 * `vault.getConfig`. Returns null when the API is unavailable, so callers can warn instead of fail.
 */
export function isLinkAutoUpdateEnabled(app: App): boolean | null {
  const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
  if (typeof vault.getConfig !== 'function') return null;
  const value = vault.getConfig('alwaysUpdateLinks');
  return typeof value === 'boolean' ? value : null;
}
