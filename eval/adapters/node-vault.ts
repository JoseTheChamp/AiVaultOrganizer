import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { webCryptoHasher } from '../../src/core/hash';
import type { VaultSnapshot } from '../../src/core/model/note';
import { extension, normalizeVaultPath } from '../../src/core/model/paths';
import { type Clock, type Hasher, type SnapshotOptions, systemClock, type VaultReader } from '../../src/core/ports';
import { buildSnapshot, isHiddenPath, type RawFile } from '../../src/core/snapshot/build-snapshot';

export interface NodeVaultOptions {
  clock?: Clock;
  hasher?: Hasher;
}

/**
 * Reads a vault folder from disk. Used by the eval CLI and by tests over the on-disk fixtures.
 * Hidden files and folders are skipped, like Obsidian does.
 */
export class NodeFsVault implements VaultReader {
  private readonly clock: Clock;
  private readonly hasher: Hasher;

  constructor(
    readonly root: string,
    options: NodeVaultOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.hasher = options.hasher ?? webCryptoHasher;
  }

  async snapshot(options: SnapshotOptions = {}): Promise<VaultSnapshot> {
    const files: RawFile[] = [];
    const folders: string[] = [];
    await this.walk('', files, folders);
    return buildSnapshot({
      files,
      folders,
      ignore: options.ignore ?? [],
      hasher: this.hasher,
      now: this.clock.now(),
    });
  }

  async read(vaultPath: string): Promise<string> {
    return readFile(this.absolute(vaultPath), 'utf8');
  }

  async readBinary(vaultPath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.absolute(vaultPath)));
  }

  async exists(vaultPath: string): Promise<boolean> {
    try {
      await stat(this.absolute(vaultPath));
      return true;
    } catch {
      return false;
    }
  }

  private absolute(vaultPath: string): string {
    return path.join(this.root, ...normalizeVaultPath(vaultPath).split('/'));
  }

  private async walk(folder: string, files: RawFile[], folders: string[]): Promise<void> {
    const entries = await readdir(this.absolute(folder), { withFileTypes: true });
    for (const entry of entries) {
      const vaultPath = normalizeVaultPath(folder === '' ? entry.name : `${folder}/${entry.name}`);
      if (isHiddenPath(vaultPath)) continue;
      if (entry.isDirectory()) {
        folders.push(vaultPath);
        await this.walk(vaultPath, files, folders);
      } else if (entry.isFile()) {
        const info = await stat(this.absolute(vaultPath));
        const isMarkdown = extension(vaultPath) === 'md';
        files.push({
          path: vaultPath,
          mtime: Math.round(info.mtimeMs),
          ctime: Math.round(info.birthtimeMs || info.ctimeMs),
          size: info.size,
          content: isMarkdown ? await this.read(vaultPath) : undefined,
        });
      }
    }
  }
}
