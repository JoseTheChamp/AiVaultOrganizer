import { describe, expect, it } from 'vitest';
import { createOperation } from './operation';
import { describeOperation } from './operation-text';

describe('describeOperation', () => {
  it('says what each operation proposes', () => {
    const texts = [
      createOperation({ kind: 'move', from: 'a.md', to: 'B/a.md' }),
      createOperation({ kind: 'setProperty', path: 'a.md', key: 'type', value: 'project' }),
      createOperation({ kind: 'addTags', path: 'a.md', tags: ['x', 'y'] }),
      createOperation({ kind: 'createNote', path: 'M.md', role: 'moc', content: '' }),
      createOperation({ kind: 'flag', path: 'a.md', issue: 'query-breakage' }),
    ].map(describeOperation);
    expect(texts).toEqual([
      'Move "a.md" to "B/a.md"',
      'Set "type" to "project" in "a.md"',
      'Add #x, #y to "a.md"',
      'Create map of content note "M.md"',
      'Flag "a.md" as query breakage',
    ]);
  });
});
