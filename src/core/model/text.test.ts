import { describe, expect, it } from 'vitest';
import { plural, verb } from './text';

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'note')).toBe('1 note');
    expect(plural(0, 'note')).toBe('0 notes');
    expect(plural(2, 'category', 'categories')).toBe('2 categories');
    expect(verb(1, 'has', 'have')).toBe('has');
    expect(verb(3, 'has', 'have')).toBe('have');
  });
});
