import { describe, expect, it } from 'vitest';
import { presetCharter } from '../../core/charter/presets/index';
import { type AdjustNode, adjustTree, subfolderStart } from './adjust-tree';
import { type AddedFolder, initialChanges } from './wizard-state';

/** The tree as indented lines: groups, charter folders (by id) and added folders (by path). */
function outline(nodes: AdjustNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const label = node.kind === 'group' ? `[${node.folder}]` : node.kind === 'destination' ? node.destination.id : `+ ${node.added.path}`;
    return [`${'  '.repeat(depth)}${label}`, ...outline(node.children, depth + 1)];
  });
}

const added = (key: number, group: string, path: string): AddedFolder => ({ key, group, path, description: '' });

describe('adjustTree', () => {
  it('shows Johnny.Decimal categories under their areas, and a folder added in an area right there', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const changes = { ...initialChanges(jd), removed: ['jd-32'], added: [added(1, '10-19 Life admin', '10-19 Life admin/14 Sport')] };
    expect(outline(adjustTree(jd, changes))).toEqual([
      '[00-09 System]',
      '  jd-00',
      '[10-19 Life admin]',
      '  jd-11',
      '  jd-12',
      '  jd-13',
      '  + 10-19 Life admin/14 Sport',
      '[20-29 Work]',
      '  jd-21',
      '  jd-22',
      '  jd-23',
      '[30-39 Learning]',
      '  jd-31',
    ]);
  });

  it('puts a new top-level folder after the charter, with its subfolders right under it', () => {
    const jd = presetCharter('johnny-decimal', 'en');
    const changes = {
      ...initialChanges(jd),
      added: [added(1, '', 'Main'), added(2, 'Main', 'Main/Sub one'), added(3, 'Main/Sub one', 'Main/Sub one/Deeper'), added(4, 'Main', 'Main/')],
    };
    expect(outline(adjustTree(jd, changes)).slice(-5)).toEqual(['  jd-32', '+ Main', '  + Main/Sub one', '    + Main/Sub one/Deeper', '  + Main/']);
  });

  it("nests a subfolder of a charter folder under it, and keeps it there when the folder's name changes", () => {
    const para = presetCharter('para', 'en');
    const changes = { ...initialChanges(para), added: [added(1, '2 Areas', '2 Areas/Running')] };
    changes.paths.areas = 'Areas';
    expect(outline(adjustTree(para, changes))).toEqual(['projects', 'areas', '  + 2 Areas/Running', 'resources', 'archive']);
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
    const taken = { ...changes, added: [added(1, '10-19 Life admin', '10-19 Life admin/14 Sport')] };
    expect(subfolderStart(jd, taken, '10-19 Life admin')).toBe('10-19 Life admin/15 ');
  });

  it('starts other subfolders with their parent, and top-level folders empty', () => {
    const para = presetCharter('para', 'en');
    expect(subfolderStart(para, initialChanges(para), '2 Areas')).toBe('2 Areas/');
    expect(subfolderStart(para, initialChanges(para), '')).toBe('');
  });
});
