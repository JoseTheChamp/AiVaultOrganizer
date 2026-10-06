import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUND_TRUTH_FILE, loadFixture } from './ground-truth';
import { buildFixture, FIXTURES, FIXTURES_DIR } from './specs';

const committed = Object.entries(FIXTURES)
  .filter(([, spec]) => spec.committed)
  .map(([name]) => name);

/**
 * The committed fixtures must be exactly what the generator produces, so a change to personas,
 * the generator or messify cannot silently leave stale fixtures behind (rebuild with
 * `tsx eval/cli.ts build-fixtures` and re-baseline).
 */
describe.each(committed)('committed fixture %s', (name) => {
  const root = path.join(FIXTURES_DIR, name);

  it('matches the generator byte for byte', async () => {
    const expected = buildFixture(name);
    const files: Record<string, string> = {};
    const folders: string[] = [];
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      const relative = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
      if (entry.isFile() && entry.name.endsWith('.md')) files[relative] = await readFile(path.join(root, relative), 'utf8');
      if (entry.isFile() && entry.name === '.gitkeep') folders.push(path.dirname(relative));
    }
    expect(files).toEqual(expected.files);
    expect(folders.sort()).toEqual([...expected.emptyFolders].sort());
    expect(JSON.parse(await readFile(path.join(root, GROUND_TRUTH_FILE), 'utf8'))).toEqual(expected.truth);
  });

  it('loads as a consistent fixture of a realistic size', async () => {
    const fixture = await loadFixture(root);
    const notes = Object.keys(fixture.truth.notes).length;
    expect(notes).toBeGreaterThanOrEqual(70);
    expect(notes).toBeLessThanOrEqual(100);
    expect(fixture.truth.heldOutLinks.length).toBeGreaterThan(5);
  });
});

describe('en-medium', () => {
  it('is generated on demand at about 600 notes', () => {
    const notes = Object.keys(buildFixture('en-medium').files).length;
    expect(notes).toBeGreaterThan(500);
    expect(notes).toBeLessThan(700);
  });
});
