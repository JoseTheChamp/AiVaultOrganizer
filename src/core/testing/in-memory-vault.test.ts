import { describe, expect, it } from 'vitest';
import { tinyParaVault } from './fixtures';
import { InMemoryVault } from './in-memory-vault';

describe('InMemoryVault', () => {
  it('snapshots a fixture vault', async () => {
    const { files, folders } = tinyParaVault();
    const vault = InMemoryVault.from(files, { folders });
    const snapshot = await vault.snapshot();

    expect(snapshot.notes).toHaveLength(13);
    expect(snapshot.otherFiles.map((f) => f.path)).toEqual(['Attachments/diagram.png']);
    expect(snapshot.folders).toContain('3 Resources/Empty topic');
    const relaunch = snapshot.notes.find((n) => n.basename === 'Website relaunch');
    expect(relaunch?.inLinks).toEqual(['0 Inbox/Call notes.md', 'Daily/2026-09-30.md']);
    expect(relaunch?.outLinks).toEqual([
      '1 Projects/Website relaunch/Design brief.md',
      '3 Resources/Programming/Hosting.md',
    ]);
  });

  it('applies ignore globs', async () => {
    const { files } = tinyParaVault();
    const snapshot = await InMemoryVault.from(files).snapshot({ ignore: ['Templates/**', 'Daily/**'] });
    expect(snapshot.notes.some((n) => n.path.startsWith('Templates/'))).toBe(false);
    expect(snapshot.notes.some((n) => n.path.startsWith('Daily/'))).toBe(false);
  });

  it('reads files and reports existence of files and folders', async () => {
    const vault = InMemoryVault.from({ 'a/b.md': 'hello' });
    expect(await vault.read('a/b.md')).toBe('hello');
    expect(await vault.exists('a')).toBe(true);
    expect(await vault.exists('a/c.md')).toBe(false);
    await expect(vault.read('missing.md')).rejects.toThrow('No such file');
  });

  it('keeps ctime and advances mtime on overwrite', async () => {
    const vault = InMemoryVault.from({ 'a.md': 'one' });
    const before = (await vault.snapshot()).notes[0];
    vault.setFile('a.md', 'two');
    const after = (await vault.snapshot()).notes[0];
    expect(after?.ctime).toBe(before?.ctime);
    expect(after?.mtime).toBeGreaterThan(before?.mtime ?? 0);
    expect(after?.contentHash).not.toBe(before?.contentHash);
  });
});
