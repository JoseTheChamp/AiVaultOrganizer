import type { App, DataAdapter } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApp } from '../testing/fake-app';
import { TFile, TFolder } from '../testing/obsidian-shim';
import { ObsidianLinkIndex } from './obsidian-link-index';
import { ObsidianStorage } from './obsidian-storage';
import { isLinkAutoUpdateEnabled, ObsidianVaultWriter } from './obsidian-vault-writer';

/** Map-backed DataAdapter with the subset of behavior ObsidianStorage relies on. */
function fakeAdapter() {
  const files = new Map<string, string | ArrayBuffer>();
  const folders = new Set<string>();
  const adapter = {
    exists: async (p: string) => files.has(p) || folders.has(p),
    readBinary: async (p: string) => {
      const data = files.get(p);
      return typeof data === 'string' ? new TextEncoder().encode(data).buffer : (data as ArrayBuffer);
    },
    writeBinary: async (p: string, data: ArrayBuffer) => void files.set(p, data),
    write: async (p: string, data: string) => void files.set(p, data),
    append: async (p: string, data: string) => {
      const existing = files.get(p);
      files.set(p, `${typeof existing === 'string' ? existing : ''}${data}`);
    },
    mkdir: async (p: string) => {
      const parts = p.split('/');
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    },
    list: async (dir: string) => ({
      files: [...files.keys()].filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')),
      folders: [...folders].filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')),
    }),
    remove: async (p: string) => void files.delete(p),
  };
  return { adapter: adapter as unknown as DataAdapter, files };
}

describe('ObsidianStorage', () => {
  it('stores everything under .ai-vault-organizer and lists keys relative to it', async () => {
    const { adapter, files } = fakeAdapter();
    const storage = new ObsidianStorage(adapter);
    await storage.write('backups/a.zip', new Uint8Array([1, 2, 3]));
    await storage.append('journal/r1.jsonl', new TextEncoder().encode('{"a":1}\n'));
    await storage.append('journal/r1.jsonl', new TextEncoder().encode('{"b":2}\n'));

    expect([...files.keys()].sort()).toEqual(['.ai-vault-organizer/backups/a.zip', '.ai-vault-organizer/journal/r1.jsonl']);
    expect(new TextDecoder().decode((await storage.read('journal/r1.jsonl')) ?? new Uint8Array())).toBe('{"a":1}\n{"b":2}\n');
    expect(await storage.read('backups/a.zip')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.read('missing')).toBeNull();
    expect(await storage.list('journal/')).toEqual(['journal/r1.jsonl']);
    expect(await storage.list('nothing/')).toEqual([]);
    await storage.remove('backups/a.zip');
    expect(await storage.read('backups/a.zip')).toBeNull();
  });

  it('refuses keys that escape its folder', async () => {
    const storage = new ObsidianStorage(fakeAdapter().adapter);
    await expect(storage.write('../notes.md', new Uint8Array())).rejects.toThrow('Invalid storage key');
    await expect(storage.read('/etc/passwd')).rejects.toThrow('Invalid storage key');
  });
});

describe('ObsidianVaultWriter', () => {
  function setup() {
    const note = new TFile('a.md', { ctime: 0, mtime: 0, size: 0 });
    const empty = new TFolder('Empty');
    const busy = new TFolder('Busy');
    busy.children.push(note);
    const fileManager = { renameFile: vi.fn(), processFrontMatter: vi.fn(), trashFile: vi.fn() };
    const vault = {
      createFolder: vi.fn(),
      create: vi.fn(),
      process: vi.fn(),
      getFileByPath: (p: string) => (p === 'a.md' ? note : null),
      getAbstractFileByPath: (p: string) => ({ Empty: empty, Busy: busy })[p] ?? null,
    };
    const app = { vault, fileManager, metadataCache: {} } as unknown as App;
    return { writer: new ObsidianVaultWriter(app), vault, fileManager, note, empty };
  }

  it('routes every write through the API the plugin guidelines require', async () => {
    const { writer, vault, fileManager, note, empty } = setup();
    await writer.move('a.md', 'Projects//b.md');
    expect(fileManager.renameFile).toHaveBeenCalledWith(note, 'Projects/b.md');
    await writer.processFrontmatter('a.md', () => undefined);
    expect(fileManager.processFrontMatter).toHaveBeenCalledWith(note, expect.any(Function));
    await writer.processBody('a.md', (c) => c);
    expect(vault.process).toHaveBeenCalledWith(note, expect.any(Function));
    await writer.create('New/n.md', '# n');
    expect(vault.create).toHaveBeenCalledWith('New/n.md', '# n');
    await writer.createFolder('New');
    expect(vault.createFolder).toHaveBeenCalledWith('New');
    await writer.trashPluginCreated('a.md');
    expect(fileManager.trashFile).toHaveBeenCalledWith(note);
    expect(await writer.removeEmptyFolder('Empty')).toBe(true);
    expect(fileManager.trashFile).toHaveBeenLastCalledWith(empty);
    expect(await writer.removeEmptyFolder('Busy')).toBe(false);
    await expect(writer.move('missing.md', 'x.md')).rejects.toThrow('No such file');
  });

  it('reads the link auto-update setting defensively', () => {
    expect(isLinkAutoUpdateEnabled({ vault: { getConfig: () => true } } as unknown as App)).toBe(true);
    expect(isLinkAutoUpdateEnabled({ vault: { getConfig: () => false } } as unknown as App)).toBe(false);
    expect(isLinkAutoUpdateEnabled({ vault: {} } as unknown as App)).toBeNull();
  });
});

describe('ObsidianLinkIndex', () => {
  it('derives backlinks, outgoing links and the graph from the metadata cache', async () => {
    const stat = { ctime: 0, mtime: 0, size: 0 };
    const app = createFakeApp(
      {
        files: [
          { path: 'a.md', stat, cache: {} },
          { path: 'b.md', stat, cache: {} },
          { path: 'pic.png', stat, cache: null },
        ],
        folders: [],
        resolvedLinks: { 'a.md': { 'b.md': 2, 'pic.png': 1, 'a.md': 1 }, 'b.md': { 'a.md': 1 } },
        unresolvedLinks: { 'a.md': { Missing: 1, Gone: 2 }, 'b.md': {} },
      },
      {},
    );
    const index = new ObsidianLinkIndex(app);
    expect(await index.backlinks('a.md')).toEqual(['b.md']);
    expect(await index.outgoing('a.md')).toEqual(['b.md', 'pic.png']);
    expect(await index.graph()).toEqual({
      edges: [
        ['a.md', 'b.md'],
        ['a.md', 'pic.png'],
        ['b.md', 'a.md'],
      ],
      unresolvedCount: 2,
    });
    expect(await index.linkText('b.md', 'a.md')).toBe('b');
  });
});
