import { describe, expect, it } from 'vitest';
import { customizeCharter } from './customize';
import { presetCharter } from './presets/index';

const para = presetCharter('para', 'en');

describe('customizeCharter', () => {
  it('renames folders, drops destinations and sets conventions', () => {
    const result = customizeCharter(para, {
      paths: { projects: ' Projects/ ', resources: 'Library' },
      removed: ['archive'],
      inbox: 'Inbox',
      tagStyle: 'lowercase-kebab',
      relatedHeading: '## See also',
      mocs: true,
      ignore: ['Private/**', ' ', 'Scratch/**'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const charter = result.value;
    expect(charter.destinations.map((d) => [d.id, d.path])).toEqual([
      ['projects', 'Projects'],
      ['areas', '2 Areas'],
      ['resources', 'Library'],
    ]);
    expect(charter.inbox).toBe('Inbox');
    expect(charter.conventions.tags?.style).toBe('lowercase-kebab');
    expect(charter.conventions.links?.relatedHeading).toBe('## See also');
    expect(charter.mocs?.enabled).toBe(true);
    expect(charter.ignore).toEqual(['Private/**', 'Scratch/**']);
  });

  it('removes the inbox when its folder is cleared, and leaves the rest as it was', () => {
    const result = customizeCharter(para, { inbox: '' });
    expect(result.ok && result.value.inbox).toBeUndefined();
    expect(result.ok && result.value.destinations).toEqual(para.destinations);
  });

  it('adds folders of your own, with unique ids', () => {
    const result = customizeCharter(para, { added: [{ path: ' Hobbies/ ', description: ' Sport and photography. ' }, { path: 'Archive old/Hobbies', description: 'Old hobbies.' }] });
    expect(result.ok && result.value.destinations.slice(-2)).toEqual([
      expect.objectContaining({ id: 'hobbies', path: 'Hobbies', description: 'Sport and photography.', layout: 'flat', match: [] }),
      expect.objectContaining({ id: 'hobbies-2', path: 'Archive old/Hobbies' }),
    ]);
  });

  it('keeps the Johnny.Decimal index in step with the folders', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const result = customizeCharter(jd, {
      paths: { 'jd-13': '10-19 Life admin/13 Household' },
      removed: ['jd-32'],
      added: [{ path: '40-49 Hobbies/41 Photography', description: 'Cameras, light and photo walks.' }],
    });
    if (!result.ok) throw new Error(result.error.join(' '));
    expect(result.value.destinations.find((d) => d.path === '40-49 Hobbies/41 Photography')?.match).toEqual([{ filename: '^41\\.\\d{2}(?:\\s|$)' }]);
    const index = result.value.jd?.areas.map((area) => `${area.id} ${area.name}: ${area.categories.map((c) => `${c.id} ${c.name}`).join(', ')}`);
    expect(index).toEqual([
      '00-09 System: 00 Index',
      '10-19 Life admin: 11 Finance, 12 Health, 13 Household',
      '20-29 Work: 21 Projects, 22 Meetings, 23 Reference',
      '30-39 Learning: 31 Courses',
      '40-49 Hobbies: 41 Photography',
    ]);
  });

  it('explains what does not make a charter', () => {
    expect(customizeCharter(para, { added: [{ path: ' ', description: 'Something.' }] })).toEqual({ ok: false, error: ['A new folder needs a name.'] });
    expect(customizeCharter(para, { added: [{ path: 'Hobbies', description: '' }] })).toEqual({ ok: false, error: ['Say what goes into "Hobbies": AI files notes by that description.'] });
    expect(customizeCharter(para, { removed: para.destinations.map((d) => d.id) })).toEqual({ ok: false, error: expect.arrayContaining(['Keep at least one destination.']) as string[] });
    const same = customizeCharter(para, { paths: { projects: 'Work', areas: 'work' } });
    expect(same).toEqual({ ok: false, error: ['"work" is used by two destinations (projects and areas).'] });
    const hidden = customizeCharter(para, { paths: { projects: '.hidden' } });
    expect(hidden.ok ? [] : hidden.error).toEqual(['Folder ".hidden" (projects): must not be a hidden folder.']);
  });
});
