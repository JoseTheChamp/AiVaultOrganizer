import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoragePort } from '../../src/core/ports';

/**
 * StoragePort over a folder on disk: the eval CLI's counterpart of the plugin's
 * `.ai-vault-organizer/` folder. Keys are relative paths; keys escaping the root are rejected.
 */
export class NodeStorage implements StoragePort {
  constructor(readonly root: string) {}

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    await mkdir(path.dirname(this.path(key)), { recursive: true });
    await writeFile(this.path(key), data);
  }

  async append(key: string, data: Uint8Array): Promise<void> {
    await mkdir(path.dirname(this.path(key)), { recursive: true });
    await appendFile(this.path(key), data);
  }

  async list(prefix: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(this.root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .filter((key) => key.startsWith(prefix))
      .sort();
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    if (key.startsWith('/') || key.split('/').includes('..')) throw new Error(`Invalid storage key: ${key}`);
    return path.join(this.root, ...key.split('/'));
  }
}
