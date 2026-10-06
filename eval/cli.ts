/**
 * Node CLI over the same core the plugin runs. Commands:
 *
 *   npm run analyze -- <vault-folder> [--json]   tier 0 diagnostics, identical to "Analyze vault"
 *   tsx eval/cli.ts build-fixtures [name …]        rebuilds the committed eval fixtures (or the named ones)
 *   tsx eval/cli.ts generate-topics <folder> [--notes=600] [--seed=1]
 *                                                writes the synthetic topic vault and its ground truth
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeVault } from '../src/core/analysis/analyze';
import { formatAnalysisMarkdown } from '../src/core/analysis/report';
import { NodeFsVault } from './adapters/node-vault';
import { GROUND_TRUTH_FILE } from './fixture/ground-truth';
import { buildFixture, FIXTURES, FIXTURES_DIR, writeFixture } from './fixture/specs';
import { generateTopicVault } from './generator/topic-vault';

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'analyze') return analyzeCommand(rest);
  if (command === 'generate-topics') return generateTopicsCommand(rest);
  if (command === 'build-fixtures') return buildFixturesCommand(rest);
  process.stderr.write('Usage: tsx eval/cli.ts analyze <vault-folder> [--json] | build-fixtures [name …] | generate-topics <folder> [--notes=N] [--seed=N]\n');
  return 2;
}

/** Rebuilds the committed fixtures, or writes the named ones (any spec) to fixtures/vaults. */
async function buildFixturesCommand(args: string[]): Promise<number> {
  const names = args.filter((arg) => !arg.startsWith('--'));
  const selected = names.length > 0 ? names : Object.entries(FIXTURES).filter(([, spec]) => spec.committed).map(([name]) => name);
  for (const name of selected) {
    const root = path.join(FIXTURES_DIR, name);
    // Only ever replaces a folder that is a generated fixture (it has a ground truth file).
    if (await exists(root)) {
      if (!(await exists(path.join(root, GROUND_TRUTH_FILE)))) {
        process.stderr.write(`${root} exists but is not a generated fixture; not touching it.\n`);
        return 1;
      }
      await rm(root, { recursive: true });
    }
    const fixture = buildFixture(name);
    await writeFixture(root, fixture);
    process.stdout.write(`Wrote ${name}: ${Object.keys(fixture.files).length} notes, ${fixture.truth.heldOutLinks.length} held-out links\n`);
  }
  return 0;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

async function generateTopicsCommand(args: string[]): Promise<number> {
  const folder = args.find((arg) => !arg.startsWith('--'));
  if (!folder) {
    process.stderr.write('generate-topics: missing output folder\n');
    return 2;
  }
  const option = (name: string, fallback: number): number => {
    const value = args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
    return value === undefined ? fallback : Number(value);
  };
  const vault = generateTopicVault({ notes: option('notes', 600), seed: option('seed', 1) });
  const root = path.resolve(folder);
  for (const [file, content] of Object.entries(vault.files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  // Outside the notes, so the plugin never sees the answers.
  await writeFile(path.join(root, '.ground-truth.json'), `${JSON.stringify({ topics: vault.topics, languages: vault.languages }, null, 2)}\n`);
  process.stdout.write(`Wrote ${Object.keys(vault.files).length} notes to ${root}\n`);
  return 0;
}

async function analyzeCommand(args: string[]): Promise<number> {
  const folder = args.find((arg) => !arg.startsWith('--'));
  if (!folder) {
    process.stderr.write('analyze: missing vault folder\n');
    return 2;
  }
  const vault = new NodeFsVault(path.resolve(folder));
  const analysis = analyzeVault(await vault.snapshot(), { now: Date.now() });
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(analysis, null, 2)}\n` : formatAnalysisMarkdown(analysis));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  },
);
