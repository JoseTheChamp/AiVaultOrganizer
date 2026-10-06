import { describe, expect, it } from 'vitest';
import { createOperation } from '../model/operation';
import { InMemoryVault } from '../testing/in-memory-vault';
import { previewOperation } from './preview';

const vault = InMemoryVault.from({
  'Plan.md': '---\nType: Note\ntags: [Web_Dev]\n---\nPlan for the website. #Web_Dev',
  'Hub.md': 'Hub.\n\n## Related\n- [[Plan]]\n',
});
const deps = { read: (path: string) => vault.read(path) };

describe('previewOperation', () => {
  it('shows a property rename as the frontmatter lines that change', async () => {
    const preview = await previewOperation(createOperation({ kind: 'renameProperty', path: 'Plan.md', from: 'Type', to: 'type' }), deps);
    expect(preview).toMatchObject({ kind: 'edit', path: 'Plan.md' });
    // Rewriting frontmatter re-serializes its YAML, as Obsidian does: the flow list becomes a block list.
    const changed = preview.kind === 'edit' ? preview.lines.filter((line) => line.type === 'add' || line.type === 'remove') : [];
    expect(changed).toContainEqual({ type: 'remove', text: 'Type: Note' });
    expect(changed).toContainEqual({ type: 'add', text: 'type: Note' });
  });

  it('shows a tag fix in the frontmatter and in the text', async () => {
    const preview = await previewOperation(createOperation({ kind: 'replaceTag', path: 'Plan.md', from: 'Web_Dev', to: 'web-dev' }), deps);
    const added = preview.kind === 'edit' ? preview.lines.filter((line) => line.type === 'add').map((line) => ('text' in line ? line.text : '')) : [];
    expect(added).toEqual(['tags:', '  - web-dev', 'Plan for the website. #web-dev']);
  });

  it('reads a note that will move first at the path it has now', async () => {
    const op = createOperation({ kind: 'setProperty', path: 'Projects/Plan.md', key: 'status', value: 'active' }, { precondition: { path: 'Plan.md', contentHash: 'x' } });
    const preview = await previewOperation(op, deps);
    expect(preview).toMatchObject({ kind: 'edit', path: 'Projects/Plan.md' });
  });

  it('says when an edit would change nothing or cannot apply', async () => {
    expect(await previewOperation(createOperation({ kind: 'addRelatedLinks', path: 'Hub.md', heading: '## Related', targets: ['Plan.md'] }), deps)).toMatchObject({ kind: 'none', reason: expect.stringContaining('Nothing would change') as string });
    expect(await previewOperation(createOperation({ kind: 'setProperty', path: 'Gone.md', key: 'a', value: 1 }), deps)).toMatchObject({ kind: 'none', reason: 'The note no longer exists.' });
    expect(await previewOperation(createOperation({ kind: 'updateGeneratedSection', path: 'Hub.md', sectionId: 'moc', content: 'x' }), deps)).toMatchObject({ kind: 'none', reason: expect.stringContaining('cannot be applied') as string });
  });

  it('passes moves, folders, new notes and flags through', async () => {
    expect(await previewOperation(createOperation({ kind: 'move', from: 'Plan.md', to: 'P/Plan.md' }), deps)).toEqual({ kind: 'move', from: 'Plan.md', to: 'P/Plan.md' });
    expect(await previewOperation(createOperation({ kind: 'createNote', path: 'M.md', role: 'moc', content: 'Map' }), deps)).toEqual({ kind: 'create', path: 'M.md', content: 'Map' });
  });
});
