import type { Plugin } from 'esbuild';

export function inlineWorkerPlugin(options: { minify: boolean }): Plugin;
