import { describe, expect, it } from 'vitest';
import { createOperation } from './operation';
import { uniqueOperations } from './plan';

describe('uniqueOperations', () => {
  it('keeps each operation once, the first of any repeats, in order', () => {
    const folder = createOperation({ kind: 'createFolder', path: 'Categories' }, { rationale: 'The charter defines this folder.' });
    const again = createOperation({ kind: 'createFolder', path: 'Categories' }, { rationale: 'Holds the category notes.' });
    const note = createOperation({ kind: 'createNote', path: 'Categories/Recipes.md', role: 'category', content: '' });
    // The same change gives the same id, whoever proposed it.
    expect(again.id).toBe(folder.id);
    expect(uniqueOperations([folder, note, again])).toEqual([folder, note]);
  });
});
