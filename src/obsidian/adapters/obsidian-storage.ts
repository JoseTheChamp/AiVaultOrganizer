import { type DataAdapter, normalizePath } from 'obsidian';
import { PLUGIN_DATA_FOLDER } from '../../core/model/note';
import type { StoragePort } from '../../core/ports';

const decoder = new TextDecoder();

/**
 * The plugin's own storage: `.ai-vault-organizer/` in the vault root, accessed through
 * `vault.adapter` (allowed here and only here, see CLAUDE.md). It is a dot-folder, so Obsidian does
 * not index it and it never shows up as notes. Keys are relative paths; anything that would escape
 * the folder is rejected.
 */
export class ObsidianStorage implements StoragePort {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly root = PLUGIN_DATA_FOLDER,
  ) {}

  async read(key: string): Promise<Uint8Array | null> {
    const path = this.path(key);
    if (!(await this.adapter.exists(path))) return null;
    return new Uint8Array(await this.adapter.readBinary(path));
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const path = this.path(key);
    await this.ensureParent(path);
    await this.adapter.writeBinary(path, toArrayBuffer(data));
  }

  /** Text append (journals are JSONL); `appendBinary` needs a newer Obsidian than we support. */
  async append(key: string, data: Uint8Array): Promise<void> {
    const path = this.path(key);
    await this.ensureParent(path);
    if (await this.adapter.exists(path)) await this.adapter.append(path, decoder.decode(data));
    else await this.adapter.write(path, decoder.decode(data));
  }

  async list(prefix: string): Promise<string[]> {
    const folder = this.path(prefix.replace(/\/[^/]*$/, '') || '.');
    if (!(await this.adapter.exists(folder))) return [];
    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const listed = await this.adapter.list(dir);
      for (const file of listed.files) keys.push(file.slice(this.root.length + 1));
      for (const sub of listed.folders) await walk(sub);
    };
    await walk(folder);
    return keys.filter((key) => key.startsWith(prefix)).sort();
  }

  async remove(key: string): Promise<void> {
    const path = this.path(key);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }

  private path(key: string): string {
    const clean = key === '.' ? '' : key;
    if (clean.startsWith('/') || clean.split('/').includes('..')) throw new Error(`Invalid storage key: ${key}`);
    return normalizePath(clean === '' ? this.root : `${this.root}/${clean}`);
  }

  private async ensureParent(path: string): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent && !(await this.adapter.exists(parent))) await this.adapter.mkdir(parent);
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
