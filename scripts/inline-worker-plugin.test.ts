import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { inlineWorkerPlugin } from './inline-worker-plugin.mjs';

describe('inlineWorkerPlugin', () => {
  let dir = '';
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('bundles the worker separately and imports it as a string', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avo-worker-'));
    await writeFile(path.join(dir, 'helper.ts'), 'export const double = (x: number): number => x * 2;\n');
    await writeFile(path.join(dir, 'job.worker.ts'), "import { double } from './helper';\nself.postMessage(double(21));\n");
    await writeFile(path.join(dir, 'main.ts'), "import code from 'inline-worker:./job.worker.ts';\nexport const workerCode: string = code;\n");

    const result = await esbuild.build({
      entryPoints: [path.join(dir, 'main.ts')],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      plugins: [inlineWorkerPlugin({ minify: false })],
    });
    const mainCode = result.outputFiles[0]?.text ?? '';
    // The worker bundle is embedded in main as one JSON string literal.
    const literal = /= ("(?:[^"\\]|\\.)*postMessage(?:[^"\\]|\\.)*");/.exec(mainCode)?.[1];
    const workerCode = JSON.parse(literal ?? '""') as string;
    // A self-contained classic script that includes its own imports.
    expect(workerCode).toContain('postMessage(double(21))');
    expect(workerCode).toContain('x * 2');
    expect(workerCode).not.toMatch(/\bimport\b|\brequire\(/);
  });
});
