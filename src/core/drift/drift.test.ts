import { describe, expect, it } from 'vitest';
import { presetCharter } from '../charter/presets/index';
import { charterSchema } from '../charter/schema';
import { InMemoryVault } from '../testing/in-memory-vault';
import { computeDrift, describeDrift } from './drift';

const DAY = 24 * 60 * 60 * 1000;

describe('computeDrift', () => {
  const charter = charterSchema.parse({
    ...presetCharter('para', 'en'),
    conventions: { properties: { required: ['type'], enums: { type: ['project', 'area', 'resource', 'note'] } } },
  });

  it('finds misplaced, unplaced, stale and malformed notes', async () => {
    let now = 0;
    const vault = InMemoryVault.from(
      {
        'Vault Charter.md': '---\ncharter: true\n---\n',
        'Plan.md': '---\ntype: project\n---\n',
        'Loose.md': '---\ntype: note\n---\n',
        '0 Inbox/Old idea.md': '---\ntype: note\n---\n',
        '3 Resources/Pasta.md': '---\ntype: recipe\n---\n',
        '2 Areas/Health.md': 'no frontmatter',
        'Templates/T.md': '',
        '2026-10-01.md': '',
      },
      { clock: { now: () => now } },
    );
    vault.setFile('0 Inbox/Fresh.md', '---\ntype: note\n---\n');
    now = 30 * DAY;
    vault.setFile('0 Inbox/Fresh.md', '---\ntype: note\n---\n');
    const report = computeDrift(await vault.snapshot(), charter, { charterPath: 'Vault Charter.md', now: 31 * DAY });

    // In vault path order.
    expect(report.issues.map((i) => [i.kind, i.path])).toEqual([
      ['stale-inbox', '0 Inbox/Old idea.md'],
      ['missing-property', '2 Areas/Health.md'],
      ['misplaced', '2026-10-01.md'],
      ['invalid-value', '3 Resources/Pasta.md'],
      ['unplaced', 'Loose.md'],
      ['misplaced', 'Plan.md'],
    ]);
    expect(report.issues.find((i) => i.path === 'Plan.md')?.expected).toBe('1 Projects/Plan/Plan.md');
    expect(report.issues.find((i) => i.kind === 'stale-inbox')?.detail).toBe('In the inbox for 31 days.');
    expect(report.noteCount).toBe(7);
    expect(report.offCharter).toBe(6);
    expect(report.missingFolders).toEqual(['1 Projects', '4 Archive', 'Daily']);
    expect(describeDrift(report)).toBe(
      '6 notes are off-charter: 2 in the wrong folder, 1 outside every destination, 1 waiting in the inbox too long, 1 missing required properties, 1 with values the charter does not allow.',
    );
  });

  it('reports a clean vault', async () => {
    const vault = InMemoryVault.from({ '1 Projects/A/A.md': '---\ntype: project\n---\n' });
    const report = computeDrift(await vault.snapshot(), presetCharter('para', 'en'), { charterPath: null, now: 0 });
    expect(report.offCharter).toBe(0);
    expect(describeDrift(report)).toBe('All 1 note follow the charter.');
  });

  it('changes its fingerprint when the charter changes', async () => {
    const snapshot = await InMemoryVault.from({}).snapshot();
    const a = computeDrift(snapshot, presetCharter('para', 'en'), { charterPath: null, now: 0 });
    const b = computeDrift(snapshot, { ...presetCharter('para', 'en'), inbox: 'In' }, { charterPath: null, now: 0 });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});
