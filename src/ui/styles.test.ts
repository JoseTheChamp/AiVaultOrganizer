import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = path.join('src', 'ui');

async function components(dir = UI): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => (entry.isDirectory() ? components(path.join(dir, entry.name)) : [path.join(dir, entry.name)])));
  return nested.flat().filter((file) => file.endsWith('.svelte'));
}

/**
 * The plugin rules allow styling only in styles.css, with Obsidian's CSS variables. Components
 * therefore carry no <style> blocks, and every static `avo-` class they use must exist there.
 */
describe('component styles', async () => {
  const files = await components();
  const css = await readFile('styles.css', 'utf8');
  const defined = new Set([...css.matchAll(/\.(avo-[a-z0-9-]+)/g)].map((match) => match[1]));

  it.each(files)('%s has no <style> block and only defined classes', async (file) => {
    const source = await readFile(file, 'utf8');
    expect(source).not.toMatch(/<style[\s>]/);
    const used = [...source.matchAll(/['"`\s](avo-[a-z0-9-]+)(?=['"`\s])/g)].map((match) => match[1] as string);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
