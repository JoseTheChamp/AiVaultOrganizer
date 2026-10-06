import { describe, expect, it } from 'vitest';
import { lineDiff } from './line-diff';

describe('lineDiff', () => {
  it('shows the changed lines with context and collapses the rest', () => {
    const before = ['---', 'Type: note', '---', 'one', 'two', 'three', 'four', 'five', 'six'].join('\n');
    const after = ['---', 'type: note', '---', 'one', 'two', 'three', 'four', 'five', 'six'].join('\n');
    expect(lineDiff(before, after, 1)).toEqual([
      { type: 'same', text: '---' },
      { type: 'remove', text: 'Type: note' },
      { type: 'add', text: 'type: note' },
      { type: 'same', text: '---' },
      { type: 'gap', count: 6 },
    ]);
  });

  it('finds inserted lines in the middle of a note', () => {
    const before = 'Intro\n\n## Related\n- [[A]]\n\nOutro';
    const after = 'Intro\n\n## Related\n- [[A]]\n- [[B]]\n\nOutro';
    expect(lineDiff(before, after, 0)).toEqual([{ type: 'gap', count: 4 }, { type: 'add', text: '- [[B]]' }, { type: 'gap', count: 2 }]);
  });

  it('is empty when nothing changes', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([]);
  });
});
