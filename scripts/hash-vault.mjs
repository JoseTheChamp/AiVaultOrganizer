// Hashes every file of a vault (dot-folders such as .obsidian and .ai-vault-organizer skipped), to
// check by hand that an undo restored the vault byte for byte (docs/QA.md).
//
//   node scripts/hash-vault.mjs dev-vault > before.json
//   node scripts/hash-vault.mjs dev-vault --compare before.json
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const [root = 'dev-vault', flag, previous] = process.argv.slice(2);

async function hashes(dir, prefix = '') {
  const result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, { [`${relative}/`]: 'folder' }, await hashes(path.join(dir, entry.name), relative));
    else result[relative] = createHash('sha256').update(await readFile(path.join(dir, entry.name))).digest('hex');
  }
  return result;
}

const now = await hashes(root);
if (flag !== '--compare') {
  process.stdout.write(`${JSON.stringify(now, null, 2)}\n`);
} else {
  const before = JSON.parse(await readFile(previous, 'utf8'));
  const paths = [...new Set([...Object.keys(before), ...Object.keys(now)])].sort();
  const differences = paths.filter((file) => before[file] !== now[file]).map((file) => `${before[file] === undefined ? 'added' : now[file] === undefined ? 'missing' : 'changed'}: ${file}`);
  process.stdout.write(differences.length === 0 ? `Identical: ${paths.length} files and folders.\n` : `${differences.join('\n')}\n`);
  process.exit(differences.length === 0 ? 0 : 1);
}
