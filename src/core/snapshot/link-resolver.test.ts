import { describe, expect, it } from 'vitest';
import { LinkResolver } from './link-resolver';

const resolver = new LinkResolver([
  'Alpha.md',
  'Projects/Alpha.md',
  'Projects/Web/Plan.md',
  'Areas/Plan.md',
  'Areas/Health/Sleep.md',
  'Resources/Plan.md',
  'Attachments/diagram.png',
  'Notes/Version 1.2.md',
]);

describe('LinkResolver', () => {
  it('resolves a bare name, preferring the source folder', () => {
    expect(resolver.resolve('Plan', 'Projects/Web/Index.md')).toBe('Projects/Web/Plan.md');
    expect(resolver.resolve('Plan', 'Areas/Index.md')).toBe('Areas/Plan.md');
  });

  it('falls back to the shortest path, then alphabetical order', () => {
    expect(resolver.resolve('Plan', 'Inbox/x.md')).toBe('Areas/Plan.md');
    expect(resolver.resolve('Alpha', 'Inbox/x.md')).toBe('Alpha.md');
  });

  it('resolves explicit paths from the root and relative to the source', () => {
    expect(resolver.resolve('Projects/Alpha', 'x.md')).toBe('Projects/Alpha.md');
    expect(resolver.resolve('Health/Sleep', 'Areas/Index.md')).toBe('Areas/Health/Sleep.md');
    expect(resolver.resolve('../Plan.md', 'Areas/Health/x.md')).toBe('Areas/Plan.md');
    expect(resolver.resolve('../../Resources/Plan', 'Areas/Health/x.md')).toBe('Resources/Plan.md');
  });

  it('is case-insensitive and keeps the real casing', () => {
    expect(resolver.resolve('projects/web/plan', 'x.md')).toBe('Projects/Web/Plan.md');
  });

  it('resolves attachments and names that contain dots', () => {
    expect(resolver.resolve('diagram.png', 'x.md')).toBe('Attachments/diagram.png');
    expect(resolver.resolve('Version 1.2', 'x.md')).toBe('Notes/Version 1.2.md');
  });

  it('returns null for missing targets', () => {
    expect(resolver.resolve('Nowhere', 'x.md')).toBeNull();
    expect(resolver.resolve('', 'x.md')).toBeNull();
  });
});
