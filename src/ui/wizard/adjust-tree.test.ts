import { describe, expect, it } from 'vitest';
import { customizeCharter } from '../../core/charter/customize';
import { presetCharter } from '../../core/charter/presets/index';
import { type AdjustNode, adjustTree, charterChanges, moveNode, subfolderStart } from './adjust-tree';
import { type AddedFolder, foundFolder, initialChanges } from './wizard-state';

/** The tree as indented lines: groups and folders by their path, new folders marked. */
function outline(nodes: AdjustNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [`${'  '.repeat(depth)}${node.kind === 'added' ? '+ ' : node.kind === 'group' ? '# ' : ''}${node.path}`, ...outline(node.children, depth + 1)]);
}

const added = (key: number, parent: string, name: string): AddedFolder => ({ key, parent, name, description: 'Something.' });

describe('adjustTree', () => {
  it('shows Johnny.Decimal categories under their areas, and a folder added in an area right there', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const changes = { ...initialChanges(jd), removed: ['jd-32'], added: [added(1, 'g:10-19 Life admin', '14 Sport')] };
    expect(outline(adjustTree(jd, changes))).toEqual([
      '# 00-09 System',
      '  00-09 System/00 Index',
      '# 10-19 Life admin',
      '  10-19 Life admin/11 Finance',
      '  10-19 Life admin/12 Health',
      '  10-19 Life admin/13 Home',
      '  + 10-19 Life admin/14 Sport',
      '# 20-29 Work',
      '  20-29 Work/21 Projects',
      '  20-29 Work/22 Meetings',
      '  20-29 Work/23 Reference',
      '# 30-39 Learning',
      '  30-39 Learning/31 Courses',
    ]);
  });

  it('puts a new top-level folder after the charter, its subfolders under it, and carries them along a rename', () => {
    const para = presetCharter('para', 'en');
    const changes = { ...initialChanges(para), added: [added(1, '', 'Main'), added(2, 'a:1', 'Sub'), added(3, 'a:2', 'Deeper'), added(4, 'd:areas', 'Running')] };
    changes.paths.areas = 'Areas';
    expect(outline(adjustTree(para, changes))).toEqual([
      '1 Projects',
      'Areas',
      '  + Areas/Running',
      '3 Resources',
      '4 Archive',
      '+ Main',
      '  + Main/Sub',
      '    + Main/Sub/Deeper',
    ]);
    changes.added[0] = { ...(changes.added[0] as AddedFolder), name: 'Hobbies' };
    expect(outline(adjustTree(para, changes)).slice(-3)).toEqual(['+ Hobbies', '  + Hobbies/Sub', '    + Hobbies/Sub/Deeper']);
  });

  it('places a folder found in the vault under its charter folder or its area', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    expect(foundFolder('10-19 Life admin/15 Travel', 1, jd)).toEqual({ key: 1, parent: 'g:10-19 Life admin', name: '15 Travel', description: 'Notes about Travel.' });
    expect(foundFolder('10-19 Life admin/11 Finance/Taxes', 2, jd)).toMatchObject({ parent: 'd:jd-11', name: 'Taxes' });
  });
});

describe('moveNode', () => {
  it('moves a folder among its siblings, and the charter keeps that order', () => {
    const para = presetCharter('para', 'en');
    const changes = { ...initialChanges(para), added: [added(1, '', 'Hobbies')] };
    const order = moveNode(adjustTree(para, changes), 'a:1', 'd:projects', false);
    expect(order?.slice(0, 2)).toEqual(['a:1', 'd:projects']);
    const moved = { ...changes, order: order ?? [] };
    expect(outline(adjustTree(para, moved))[0]).toBe('+ Hobbies');
    const result = customizeCharter(para, charterChanges(para, moved));
    expect(result.ok && result.value.destinations.map((d) => d.path)).toEqual(['Hobbies', '1 Projects', '2 Areas', '3 Resources', '4 Archive']);
  });

  it('moves an area with its categories, and never into another folder', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const tree = adjustTree(jd, initialChanges(jd));
    const order = moveNode(tree, 'g:30-39 Learning', 'g:00-09 System', false);
    expect(order?.slice(0, 3)).toEqual(['g:30-39 Learning', 'd:jd-31', 'd:jd-32']);
    // A category belongs to its area: it cannot be dropped next to another area's categories.
    expect(moveNode(tree, 'd:jd-31', 'd:jd-11', false)).toBeNull();
  });
});

describe('subfolderStart', () => {
  it('starts a Johnny.Decimal category with the first free number of its area', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const changes = initialChanges(jd);
    expect(subfolderStart(jd, changes, '10-19 Life admin')).toBe('14 ');
    // 01 and 02 hold the inbox and daily notes.
    expect(subfolderStart(jd, changes, '00-09 System')).toBe('03 ');
    // A number typed into another new folder is taken too.
    expect(subfolderStart(jd, { ...changes, added: [added(1, 'g:10-19 Life admin', '14 Sport')] }, '10-19 Life admin')).toBe('15 ');
  });

  it('starts other names empty', () => {
    const para = presetCharter('para', 'en');
    expect(subfolderStart(para, initialChanges(para), '2 Areas')).toBe('');
    expect(subfolderStart(para, initialChanges(para), '')).toBe('');
  });
});
