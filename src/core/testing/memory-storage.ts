import type { StoragePort } from '../ports';

/** In-memory StoragePort for tests: the plugin's `.ai-vault-organizer/` folder as a map. */
export class MemoryStorage implements StoragePort {
  readonly entries = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | null> {
    return this.entries.get(key) ?? null;
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    this.entries.set(key, data);
  }

  async append(key: string, data: Uint8Array): Promise<void> {
    const existing = this.entries.get(key) ?? new Uint8Array();
    const merged = new Uint8Array(existing.length + data.length);
    merged.set(existing);
    merged.set(data, existing.length);
    this.entries.set(key, merged);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }

  text(key: string): string | null {
    const data = this.entries.get(key);
    return data ? new TextDecoder().decode(data) : null;
  }
}
