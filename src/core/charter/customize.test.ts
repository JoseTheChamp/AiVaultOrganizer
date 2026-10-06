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

  it('explains what does not make a charter', () => {
    expect(customizeCharter(para, { removed: para.destinations.map((d) => d.id) })).toEqual({ ok: false, error: expect.arrayContaining(['Keep at least one destination.']) as string[] });
    const same = customizeCharter(para, { paths: { projects: 'Work', areas: 'work' } });
    expect(same).toEqual({ ok: false, error: ['"work" is used by two destinations (projects and areas).'] });
    const hidden = customizeCharter(para, { paths: { projects: '.hidden' } });
    expect(hidden.ok ? [] : hidden.error).toEqual(['Folder ".hidden" (projects): must not be a hidden folder.']);
  });
});
