// Pre-commit hook: lints the staged TypeScript, JavaScript and Svelte files (and package.json) with ESLint.
// Replaces nano-staged 1.0.2, which decodes git's output chunk by chunk and so corrupts non-ASCII
// file names (Czech fixture notes) whenever a multi-byte character spans two chunks.
// Lints the working-tree version of each staged file; this repo always stages whole files.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const LINTED = /\.(?:ts|mts|mjs|svelte)$|(?:^|\/)package\.json$/;

// -z: NUL-separated raw bytes, decoded once as a whole, so names arrive intact.
const output = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { encoding: 'buffer' });
const files = output
  .toString('utf8')
  .split('\0')
  .filter((file) => file !== '' && LINTED.test(file));

if (files.length > 0) {
  // ESLint's own entry point through Node: no shell, so paths need no quoting on any OS.
  const eslint = path.join('node_modules', 'eslint', 'bin', 'eslint.js');
  const result = spawnSync(process.execPath, [eslint, '--max-warnings=0', ...files], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
