import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The obsidian npm package ships types only; tests run adapters against a small shim.
    alias: { obsidian: path.resolve(import.meta.dirname, 'src/obsidian/testing/obsidian-shim.ts') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'eval/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Tests never touch the network: providers run against recorded cassettes.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'eval/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing/**'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
