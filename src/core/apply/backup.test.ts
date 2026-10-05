import { describe, expect, it } from 'vitest';
import { sha256Hex, webCryptoHasher } from '../hash';
import { silentLogger } from '../ports';
import { InMemoryVault } from '../testing/in-memory-vault';
import { MemoryStorage } from '../testing/memory-storage';
import { BackupService } from './backup';

function setup(files: Record<string, string>) {
  let now = Date.UTC(2026, 9, 5, 12, 0, 0);
  const clock = { now: () => (now += 60_000) };
  const vault = InMemoryVault.from(files, { clock });
  const storage = new MemoryStorage();
  const backups = new BackupService({ reader: vault, storage, hasher: webCryptoHasher, clock, logger: silentLogger });
  return { vault, storage, backups };
}

const files = {
  'Home.md': '# Home\nPříliš žluťoučký kůň',
  'Projects/Plan.md': '---\ntype: project\n---\n',
  'Board.canvas': '{"nodes":[]}',
  'Tasks.base': 'views: []',
  'Attachments/pic.png': 'PNG',
  '.obsidian/app.json': '{}',
};

describe('BackupService', () => {
  it('zips notes, canvases and bases with a verifiable manifest', async () => {
    const { backups } = setup(files);
    const result = await backups.create({ planId: 'plan 1/2', pluginVersion: '0.1.0' });

    expect(result.key).toMatch(/^backups\/20261005T\d{6}Z-plan-1-2\.zip$/);
    expect(result.manifest).toMatchObject({ version: 1, planId: 'plan 1/2', pluginVersion: '0.1.0', includesAttachments: false });
    expect(result.manifest.files.map((f) => f.path)).toEqual(['Board.canvas', 'Home.md', 'Projects/Plan.md', 'Tasks.base']);
    expect(result.manifest.files.find((f) => f.path === 'Home.md')?.sha256).toBe(await sha256Hex(files['Home.md']));

    const inspected = await backups.inspect(result.key);
    expect(inspected.intact).toBe(true);
    expect(new TextDecoder().decode(inspected.files.get('Home.md'))).toBe(files['Home.md']);
  });

  it('includes attachments only on request', async () => {
    const { backups } = setup(files);
    const result = await backups.create({ pluginVersion: '0.1.0', includeAttachments: true });
    expect(result.key).toMatch(/-manual\.zip$/);
    expect(result.manifest.files.map((f) => f.path)).toContain('Attachments/pic.png');
  });

  it('detects a damaged archive', async () => {
    const { backups, storage } = setup({ 'a.md': 'original' });
    const { key } = await backups.create({ pluginVersion: '0.1.0' });
    const { strToU8, unzipSync, zipSync } = await import('fflate');
    const entries = unzipSync((await storage.read(key)) ?? new Uint8Array());
    entries['vault/a.md'] = strToU8('tampered');
    await storage.write(key, zipSync(entries));
    expect((await backups.inspect(key)).intact).toBe(false);
  });

  it('lists newest first and prunes only its own backups', async () => {
    const { backups, storage } = setup({ 'a.md': 'x' });
    const keys = [];
    for (let i = 0; i < 4; i++) keys.push((await backups.create({ pluginVersion: '0.1.0' })).key);
    await storage.write('backups/user-file.zip', new Uint8Array([1]));
    expect(await backups.list()).toEqual([...keys].reverse());
    expect(await backups.prune(2)).toEqual([keys[1], keys[0]]);
    expect(await storage.list('backups/')).toEqual([keys[2], keys[3], 'backups/user-file.zip'].sort());
  });
});
