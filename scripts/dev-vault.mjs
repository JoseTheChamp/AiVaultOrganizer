// (Re)generates dev-vault/ from a fixture vault for manual testing in Obsidian, and installs the
// built plugin into it. Usage: node scripts/dev-vault.mjs [fixture-name]   (default: tiny)
//
// Safety: an existing dev-vault/ is only replaced when it carries the marker file this script
// writes, so a folder someone else put there is never wiped.
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = process.argv[2] ?? 'tiny';
const source = path.join('fixtures', 'vaults', fixture);
const target = 'dev-vault';
const marker = path.join(target, '.dev-vault');
const pluginDir = path.join(target, '.obsidian', 'plugins', 'ai-vault-organizer');

const exists = async (p) => stat(p).then(() => true, () => false);

if (!(await exists(source))) {
  console.error(`Unknown fixture "${fixture}". Available: ${(await readdir(path.join('fixtures', 'vaults'))).join(', ')}`);
  process.exit(1);
}
if (await exists(target)) {
  if (!(await exists(marker))) {
    console.error(`${target}/ exists but was not created by this script; move it away first.`);
    process.exit(1);
  }
  // Keep Obsidian's workspace and plugin data between regenerations; replace only the notes.
  for (const entry of await readdir(target)) {
    if (entry === '.obsidian' || entry === '.dev-vault') continue;
    await rm(path.join(target, entry), { recursive: true, force: true });
  }
}

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
// Recreate empty folders that git only kept through .gitkeep files.
for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
  if (entry.isDirectory()) await mkdir(path.join(target, path.relative(source, path.join(entry.parentPath, entry.name))), { recursive: true });
}
await writeFile(marker, `Generated from ${source}. Safe to delete.\n`);
await mkdir(pluginDir, { recursive: true });
await writeFile(path.join(target, '.obsidian', 'community-plugins.json'), JSON.stringify(['ai-vault-organizer'], null, 2));
await writeFile(path.join(target, '.obsidian', 'app.json'), JSON.stringify({ alwaysUpdateLinks: true }, null, 2));

let installed = false;
for (const asset of ['main.js', 'manifest.json', 'styles.css']) {
  if (await exists(asset)) {
    await cp(asset, path.join(pluginDir, asset));
    installed ||= asset === 'main.js';
  }
}
console.log(`dev-vault/ generated from ${source}.`);
console.log(installed ? 'Plugin installed from the production build.' : 'Run `npm run dev` to build the plugin into it.');
