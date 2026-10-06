import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NodeStorage } from './node-storage';

describe('NodeStorage', () => {
  let dir = '';
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('reads, writes, appends, lists files by prefix and removes them', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avo-storage-'));
    const storage = new NodeStorage(dir);
    const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
    expect(await storage.read('cache/missing.bin')).toBeNull();
    await storage.write('cache/index/a.bin', new TextEncoder().encode('one'));
    await storage.append('cache/index/a.bin', new TextEncoder().encode(' two'));
    await storage.write('journal/run.jsonl', new TextEncoder().encode('{}'));
    expect(text(await storage.read('cache/index/a.bin'))).toBe('one two');
    expect(await storage.list('cache/')).toEqual(['cache/index/a.bin']);
    await storage.remove('cache/index/a.bin');
    expect(await storage.list('cache/')).toEqual([]);
    expect(await new NodeStorage(path.join(dir, 'nothing-here')).list('')).toEqual([]);
  });

  it('rejects keys that escape its folder', async () => {
    const storage = new NodeStorage(dir || tmpdir());
    await expect(storage.write('../outside.txt', new Uint8Array())).rejects.toThrow(/Invalid storage key/);
  });
});
