import { describe, expect, it } from 'vitest';
import { createOperation } from '../model/operation';
import { InMemoryVault } from '../testing/in-memory-vault';
import { findFolderQueries, queryBreakageOperations } from './query-breakage';

const dashboard = [
  '# Dashboard',
  '```dataview',
  'TABLE status',
  'FROM "Projects" AND -"Projects/Archive"',
  'WHERE status = "active"',
  '```',
  '```dataview',
  'LIST FROM #inbox',
  '```',
  '```dataviewjs',
  "dv.list(dv.pages('\"Areas\"').file.name)",
  '```',
  '```js',
  'FROM "NotAQuery"',
  '```',
  'Text mentioning FROM "Prose" is not a query.',
].join('\n');

const base = ['filters:', '  and:', '    - file.inFolder("Inbox")', '    - file.folder == "Inbox/Clips"', 'views:', '  - type: table'].join('\n');

describe('findFolderQueries', () => {
  it('finds folders in Dataview, DataviewJS and Bases, with their lines, and nothing else', () => {
    expect(findFolderQueries('Dashboard.md', dashboard)).toEqual([
      { path: 'Dashboard.md', line: 4, folder: 'Projects', kind: 'Dataview' },
      { path: 'Dashboard.md', line: 4, folder: 'Projects/Archive', kind: 'Dataview' },
      { path: 'Dashboard.md', line: 11, folder: 'Areas', kind: 'Dataview' },
    ]);
    expect(findFolderQueries('Inbox.base', base)).toEqual([
      { path: 'Inbox.base', line: 3, folder: 'Inbox', kind: 'Bases' },
      { path: 'Inbox.base', line: 4, folder: 'Inbox/Clips', kind: 'Bases' },
    ]);
    expect(findFolderQueries('Embedded.md', `Intro\n\`\`\`base\n${base}\n\`\`\``).map((q) => q.line)).toEqual([5, 6]);
  });
});

describe('queryBreakageOperations', () => {
  it('flags queries whose folders the plan moves notes into or out of, once per file and folder', async () => {
    const vault = InMemoryVault.from({ 'Dashboard.md': dashboard, 'Projects/Site.md': 'Site.', 'Inbox/Clip.md': 'Clip.', 'Areas/Health.md': 'Health.' });
    vault.setFile('Inbox.base', base);
    const snapshot = await vault.snapshot();
    const moves = [
      createOperation({ kind: 'move', from: 'Projects/Site.md', to: 'Archive/Site.md' }),
      createOperation({ kind: 'move', from: 'Inbox/Clip.md', to: 'Resources/Clip.md' }),
      // Within the folder: the query still finds it.
      createOperation({ kind: 'move', from: 'Areas/Health.md', to: 'Areas/Health/Health.md' }),
    ];
    const flags = await queryBreakageOperations(snapshot, moves, (path) => vault.read(path));
    expect(flags.map((op) => (op.kind === 'flag' ? `${op.path} ${op.issue} ${op.related?.join()}` : op.kind))).toEqual([
      'Dashboard.md query-breakage Projects',
      'Inbox.base query-breakage Inbox',
    ]);
    expect(flags[0]?.rationale).toBe('Line 4: a Dataview query reads the folder "Projects", and 1 planned move changes what it finds (for example "Projects/Site.md" moves out of it). Update the query after applying.');
    expect(await queryBreakageOperations(snapshot, [], (path) => vault.read(path))).toEqual([]);
  });
});
