import type { NoteCard } from '../planner/cards';

/** A note card for tests: just a title and an excerpt unless more is given. */
export function testCard(path: string, excerpt = `About ${path.replace(/\.md$/, '')}.`, overrides: Partial<NoteCard> = {}): NoteCard {
  return {
    path,
    title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    tags: [],
    properties: {},
    headings: [],
    excerpt,
    links: [],
    age: null,
    cluster: null,
    ...overrides,
  };
}
