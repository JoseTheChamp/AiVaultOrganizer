import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets';
import { createOperation, type Operation } from '../model/operation';
import { InMemoryVault } from '../testing/in-memory-vault';
import { emptiedFolderOperations } from './emptied-folders';

const para = presetCharter('para', 'en');
const move = (from: string, to: string, confidence = 0.9) => createOperation({ kind: 'move', from, to }, { confidence });

async function removals(files: Record<string, string>, folders: string[], operations: Operation[], charter = para) {
  const snapshot = await InMemoryVault.from(files, { folders }).snapshot();
  return emptiedFolderOperations(snapshot, charter, operations).map((op) => [op.kind === 'removeEmptyFolder' ? op.path : '', op.confidence]);
}

describe('emptiedFolderOperations', () => {
  it('removes the folders the moves empty, deepest first, as confident as the least sure move out', async () => {
    const files = { 'Old/Sub/a.md': '', 'Old/b.md': '', 'Busy/c.md': '', 'Busy/d.md': '', 'Pics/p.png': '', '2 Areas/Health/f.md': '' };
    const result = await removals(files, ['Old/Empty', 'Placeholder'], [
      move('Old/Sub/a.md', '3 Resources/a.md', 0.7),
      move('Old/b.md', '3 Resources/b.md'),
      move('Busy/c.md', '3 Resources/c.md'),
      move('2 Areas/Health/f.md', '4 Archive/f.md'),
    ]);
    // Busy keeps a note, Pics an image, and Placeholder was empty before: they stay. An item folder
    // inside a charter folder goes; the charter folder itself stays.
    expect(result).toEqual([
      ['2 Areas/Health', 0.9],
      ['Old/Empty', 1],
      ['Old/Sub', 0.7],
      ['Old', 0.7],
    ]);
  });

  it("keeps the charter's folders, their parents, the system folders and ignored ones", async () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const files = { '00-09 System/01 Inbox/a.md': '', 'Templates/t.md': '', 'Private/p.md': '', 'Stray/s.md': '' };
    const charter = { ...jd, ignore: [...jd.ignore, 'Private/**'] };
    const out = (path: string) => move(path, `10-19 Life admin/11 Finance/${path.split('/').pop() ?? ''}`);
    const result = await removals(files, [], [out('00-09 System/01 Inbox/a.md'), out('Templates/t.md'), out('Private/p.md'), out('Stray/s.md')], charter);
    expect(result).toEqual([['Stray', 0.9]]);
  });

  it('keeps a folder the plan still uses for a new note or a new folder', async () => {
    const files = { 'Old/a.md': '', 'Other/b.md': '' };
    const result = await removals(files, [], [
      move('Old/a.md', '3 Resources/a.md'),
      move('Other/b.md', '3 Resources/b.md'),
      createOperation({ kind: 'createNote', path: 'Old/Map.md', role: 'moc', content: '' }),
      createOperation({ kind: 'createFolder', path: 'Other/New' }),
    ]);
    expect(result).toEqual([]);
  });
});
