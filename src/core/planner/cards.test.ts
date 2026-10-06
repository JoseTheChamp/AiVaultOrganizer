import { describe, expect, it } from 'vitest';
import { testCard } from '../testing/cards';
import { InMemoryVault } from '../testing/in-memory-vault';
import { ageBucket, buildCard, renderCard } from './cards';

const DAY = 86_400_000;

describe('buildCard', () => {
  it('summarizes a note compactly and skips private notes', async () => {
    const vault = InMemoryVault.from({
      'Garden/Tomatoes.md': '---\ntags: [garden]\nType: note\nstatus: [active, growing]\npassword: secret\n---\n# Seedlings\nThe seedlings need more light. [[Compost]] helps.\n\n```js\ncode()\n```',
      'Compost.md': 'Turn it often.',
      'Diary.md': '---\nai-vault-organizer: private\n---\nSecret.',
    });
    const notes = (await vault.snapshot()).notes;
    const tomatoes = notes.find((n) => n.path === 'Garden/Tomatoes.md');
    const diary = notes.find((n) => n.path === 'Diary.md');
    if (!tomatoes || !diary) throw new Error('missing notes');
    const card = buildCard(tomatoes, await vault.read(tomatoes.path), { excerptChars: 30, headings: 10, links: 10 }, { now: tomatoes.mtime + 3 * DAY, cluster: 'Gardening' });
    expect(card).toEqual({
      path: 'Garden/Tomatoes.md',
      title: 'Tomatoes',
      folder: 'Garden',
      tags: ['garden'],
      // Only organizing properties, matched case-insensitively; never arbitrary keys.
      properties: { type: 'note', status: 'active, growing' },
      headings: ['Seedlings'],
      excerpt: 'The seedlings need more…',
      links: ['Compost'],
      age: 'this week',
      cluster: 'Gardening',
    });
    expect(buildCard(diary, await vault.read(diary.path))).toBeNull();
    expect(buildCard(tomatoes, await vault.read(tomatoes.path))?.age).toBeNull();
  });
});

describe('renderCard', () => {
  const card = testCard('Garden/Tomatoes.md', 'The seedlings need more light.', {
    tags: ['garden'],
    properties: { type: 'note' },
    headings: ['Seedlings'],
    links: ['Compost'],
    age: 'this month',
    cluster: 'Gardening',
  });

  it('renders the original fields unless extended, so earlier prompt versions stay identical', () => {
    expect(renderCard(card)).toBe('Title: Tomatoes\nTags: #garden\nHeadings: Seedlings\nLinks to: Compost\nText: The seedlings need more light.');
  });

  it('adds folder, properties, group and age when extended', () => {
    expect(renderCard(card, 20, true)).toBe(
      'Title: Tomatoes\nFolder: Garden\nTags: #garden\nProperties: type: note\nHeadings: Seedlings\nLinks to: Compost\nGroup: Gardening\nLast changed: this month\nText: The seedlings need…',
    );
  });
});

describe('ageBucket', () => {
  it('buckets by days since the last change', () => {
    expect([1, 10, 100, 400].map((days) => ageBucket(0, days * DAY))).toEqual(['this week', 'this month', 'this year', 'older']);
  });
});
