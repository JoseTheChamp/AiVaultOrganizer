// Bundles the plugin. `node esbuild.config.mjs` watches and writes into the dev vault;
// `node esbuild.config.mjs production` writes main.js (+ styles.css, manifest.json) at the repo root.
import { builtinModules } from 'node:module';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import esbuild from 'esbuild';

const production = process.argv[2] === 'production';
const pluginId = 'ai-vault-organizer';
const devDir = path.join('dev-vault', '.obsidian', 'plugins', pluginId);
const outDir = production ? '.' : devDir;

// Raised deliberately when a dependency is added; catches accidental bloat such as
// `import { z } from 'zod'`, which pulls every zod locale (~260 kB) into the bundle.
const MAX_BUNDLE_BYTES = 200 * 1024;

const banner = `/*
AI Vault Organizer — bundled by esbuild. Source: https://github.com/JoseTheChamp/AiVaultOrganizer
*/`;

/** Copies the static plugin assets next to main.js after every (re)build in dev mode. */
const copyAssets = {
  name: 'copy-assets',
  setup(build) {
    build.onEnd(async (result) => {
      if (production || result.errors.length > 0) return;
      await mkdir(devDir, { recursive: true });
      await copyFile('manifest.json', path.join(devDir, 'manifest.json'));
      await copyFile('styles.css', path.join(devDir, 'styles.css'));
      // Picked up by the "Hot Reload" community plugin if installed in the dev vault.
      await writeFile(path.join(devDir, '.hotreload'), '');
    });
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/obsidian/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/*',
    '@lezer/*',
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  minify: production,
  outfile: path.join(outDir, 'main.js'),
  plugins: [copyAssets],
});

if (production) {
  await context.rebuild();
  await context.dispose();
  const { size } = await stat('main.js');
  if (size > MAX_BUNDLE_BYTES) {
    console.error(`main.js is ${Math.round(size / 1024)} kB, over the ${MAX_BUNDLE_BYTES / 1024} kB budget.`);
    process.exit(1);
  }
} else {
  await context.watch();
}
