import { describe, expect, it } from 'vitest';
import { tinyFlatVault, tinyParaVault } from '../testing/fixtures';
import { InMemoryVault } from '../testing/in-memory-vault';
import { analyzeVault } from './analyze';

const DAY = 24 * 60 * 60 * 1000;

async function analyze(files: Record<string, string>, folders: string[] = [], now = Date.now()) {
  const snapshot = await InMemoryVault.from(files, { folders, clock: { now: () => 0 } }).snapshot();
  return analyzeVault(snapshot, { now });
}

const component = (report: Awaited<ReturnType<typeof analyze>>, id: string) =>
  report.health.components.find((c) => c.id === id);

describe('computeHealth', () => {
  it('gives a well-linked, tidy vault a high score', async () => {
    const report = await analyze(
      {
        'Topics/a.md': '---\ntype: note\n---\n[[b]] #topic',
        'Topics/b.md': '---\ntype: note\n---\n[[c]] #topic',
        'Topics/c.md': '---\ntype: note\n---\n[[a]] #topic',
      },
      [],
      0,
    );
    expect(report.health.score).toBe(100);
    expect(report.health.grade).toBe('good');
  });

  it('penalizes orphans, root clutter, broken links and empty folders', async () => {
    const report = await analyze(
      { 'a.md': '[[Missing]]', 'b.md': '', 'c.md': '', 'Folder/d.md': '' },
      ['Empty 1', 'Empty 2'],
    );
    expect(component(report, 'orphans')?.value).toBe(0);
    expect(component(report, 'root-clutter')?.value).toBe(0);
    expect(component(report, 'unresolved-links')?.value).toBeCloseTo(1 - 0.25 / 0.3, 2);
    expect(component(report, 'empty-folders')?.value).toBe(0);
    expect(report.health.grade).toBe('poor');
  });

  it('does not count dated notes as orphans', async () => {
    const report = await analyze({ 'Daily/2026-10-01.md': 'x', 'Daily/2026-10-02.md': 'y' });
    expect(component(report, 'orphans')?.value).toBe(1);
  });

  it('ignores root clutter in a flat vault and inbox backlog without an inbox', async () => {
    const { files, folders } = tinyFlatVault();
    const report = await analyze(files, folders);
    expect(component(report, 'root-clutter')?.weight).toBe(0);
    expect(component(report, 'inbox-backlog')?.weight).toBe(0);
  });

  it('counts stale inbox notes', async () => {
    const { files, folders } = tinyParaVault();
    const report = await analyze(files, folders, 30 * DAY);
    const inbox = component(report, 'inbox-backlog');
    expect(inbox?.weight).toBeGreaterThan(0);
    expect(inbox?.detail).toBe('2 notes in "0 Inbox" are older than 14 days.');
  });

  it('flags tag spelling variants', async () => {
    const report = await analyze({ 'a.md': '#ProjectX', 'b.md': '#project-x', 'c.md': '#projectx' });
    expect(component(report, 'tag-variants')?.value).toBe(0);
  });

  it('returns 100 for an empty vault instead of dividing by zero', async () => {
    expect((await analyze({})).health.score).toBe(100);
  });
});
