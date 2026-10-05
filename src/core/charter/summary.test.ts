import { describe, expect, it } from 'vitest';
import { presetCharter } from './presets/index';
import { formatCharterIssues, summarizeCharter } from './summary';

describe('summarizeCharter', () => {
  it('summarizes destinations, rules and system folders', () => {
    const summary = summarizeCharter(presetCharter('para', 'en'));
    expect(summary.title).toBe('PARA charter');
    expect(summary.chips).toEqual(['Revision 1', 'Language en', 'Folders mode']);
    expect(summary.destinations[0]).toEqual({
      id: 'projects',
      where: '1 Projects (folder per item)',
      rules: 'type: project',
      description: 'Active projects with a clear goal and an end.',
    });
    expect(summary.destinations[3]?.rules).toBe('status: done | archived');
    expect(summary.system.map((row) => row.label)).toEqual(['Inbox', 'Daily notes', 'Attachments', 'Templates']);
    expect(summary.jd).toEqual([]);
  });

  it('lists the Johnny.Decimal index', () => {
    const summary = summarizeCharter(presetCharter('johnny-decimal', 'en'));
    expect(summary.jd[1]).toEqual({ area: '10-19 Life admin', categories: '11 Finance, 12 Health, 13 Home' });
  });

  it('formats issues with line and path', () => {
    expect(formatCharterIssues([{ message: 'bad', path: 'destinations.0.path', line: 9 }, { message: 'syntax', path: '' }])).toEqual([
      'Line 9: destinations.0.path: bad',
      'syntax',
    ]);
  });
});
