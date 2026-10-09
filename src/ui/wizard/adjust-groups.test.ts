import { describe, expect, it } from 'vitest';
import { presetCharter } from '../../core/charter/presets/index';
import { adjustGroups, subfolderStart } from './adjust-groups';
import { initialChanges } from './wizard-state';

describe('adjustGroups', () => {
  it('groups Johnny.Decimal categories by area, with added folders where they were added', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const changes = { ...initialChanges(jd), removed: ['jd-32'], added: [{ key: 1, group: '10-19 Life admin', path: '10-19 Life admin/14 Sport', description: '' }] };
    const groups = adjustGroups(jd, changes).map((group) => [group.folder, group.destinations.map((d) => d.id).join(' '), group.added.map((f) => f.path).join(' ')]);
    expect(groups).toEqual([
      ['00-09 System', 'jd-00', ''],
      ['10-19 Life admin', 'jd-11 jd-12 jd-13', '10-19 Life admin/14 Sport'],
      ['20-29 Work', 'jd-21 jd-22 jd-23', ''],
      ['30-39 Learning', 'jd-31', ''],
    ]);
  });

  it('keeps top-level folders together, first', () => {
    const para = presetCharter('para', 'en');
    const changes = { ...initialChanges(para), added: [{ key: 1, group: '2 Areas', path: '2 Areas/Running', description: '' }] };
    expect(adjustGroups(para, changes).map((group) => [group.folder, group.destinations.length, group.added.length])).toEqual([
      ['', 4, 0],
      ['2 Areas', 0, 1],
    ]);
  });
});

describe('subfolderStart', () => {
  it('starts a Johnny.Decimal category with the first free number of its area', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const changes = initialChanges(jd);
    expect(subfolderStart(jd, changes, '10-19 Life admin')).toBe('10-19 Life admin/14 ');
    // 01 and 02 hold the inbox and daily notes.
    expect(subfolderStart(jd, changes, '00-09 System')).toBe('00-09 System/03 ');
    // A number typed into another new folder is taken too.
    const taken = { ...changes, added: [{ key: 1, group: '10-19 Life admin', path: '10-19 Life admin/14 Sport', description: '' }] };
    expect(subfolderStart(jd, taken, '10-19 Life admin')).toBe('10-19 Life admin/15 ');
  });

  it('starts other subfolders with their parent, and top-level folders empty', () => {
    const para = presetCharter('para', 'en');
    expect(subfolderStart(para, initialChanges(para), '2 Areas')).toBe('2 Areas/');
    expect(subfolderStart(para, initialChanges(para), '')).toBe('');
  });
});
