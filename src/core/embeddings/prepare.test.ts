import { describe, expect, it } from 'vitest';
import { prepareNote, preparedText } from './prepare';

describe('prepareNote', () => {
  it('keeps the meaning and drops syntax, code, comments, embeds and URLs', () => {
    const content = [
      '---',
      'tags: [garden]',
      'secret: not prose',
      '---',
      'Planted **tomatoes** next to [[Herbs/Basil|basil]] and [[Companion planting#Tomatoes]].',
      'See [the guide](https://example.com/guide) or https://example.com directly. #garden/vegetables',
      '![[photo.png]] ![alt](img.jpg)',
      '```python',
      'print("code is not prose")',
      '```',
      '<!-- charter:generated:start id="x" -->',
      '%% private comment %%',
      '> [!tip] Water in the *morning*',
      '- [ ] buy ==stakes==',
      '| Bed | Plant |',
      '| --- | --- |',
      '| 1 | Tomato |',
      'Footnote here[^1] ^block-id',
    ].join('\n');
    const note = prepareNote(content, 'Garden log');
    const text = preparedText(note);
    expect(text).toContain('Planted tomatoes next to basil and Companion planting Tomatoes.');
    expect(text).toContain('See the guide or directly. garden vegetables');
    expect(text).toContain('Water in the morning');
    expect(text).toContain('buy stakes');
    expect(text).toContain('Bed Plant');
    expect(text).toContain('Footnote here');
    for (const gone of ['secret', 'print', 'charter:generated', 'private comment', 'photo', 'https', '[!tip]', '^block-id', '---']) {
      expect(text).not.toContain(gone);
    }
  });

  it('splits the body into sections with heading trails', () => {
    const content = 'Intro line.\n\n# Garden\nBeds.\n## Tomatoes\nStake them.\n\nWater daily.\n## Herbs\n# Kitchen\nSoup.';
    const note = prepareNote(content, 'Notes');
    expect(note.sections).toEqual([
      { trail: [], paragraphs: ['Intro line.'] },
      { trail: ['Garden'], paragraphs: ['Beds.'] },
      { trail: ['Garden', 'Tomatoes'], paragraphs: ['Stake them.', 'Water daily.'] },
      { trail: ['Garden', 'Herbs'], paragraphs: [] },
      { trail: ['Kitchen'], paragraphs: ['Soup.'] },
    ]);
  });

  it('keeps list items of one paragraph on separate lines', () => {
    const note = prepareNote('- one\n- two\n1. three', 'List');
    expect(note.sections[0]?.paragraphs).toEqual(['one\ntwo\nthree']);
  });

  it('does not treat headings inside code blocks as headings', () => {
    const note = prepareNote('```\n# not a heading\n```\nText', 'Code');
    expect(note.sections).toEqual([{ trail: [], paragraphs: ['Text'] }]);
  });

  it('returns only the title for an empty note', () => {
    const note = prepareNote('---\na: 1\n---\n', ' Empty ');
    expect(note).toEqual({ title: 'Empty', sections: [] });
    expect(preparedText(note)).toBe('Empty');
  });
});
