/**
 * Node CLI over the same core the plugin runs. Commands:
 *
 *   npm run analyze -- <vault-folder> [--json]   tier 0 diagnostics, identical to "Analyze vault"
 */
import path from 'node:path';
import { analyzeVault } from '../src/core/analysis/analyze';
import { formatAnalysisMarkdown } from '../src/core/analysis/report';
import { NodeFsVault } from './adapters/node-vault';

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'analyze') return analyzeCommand(rest);
  process.stderr.write('Usage: tsx eval/cli.ts analyze <vault-folder> [--json]\n');
  return 2;
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
