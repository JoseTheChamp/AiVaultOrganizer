import { defineConfig } from 'vitest/config';

export default defineConfig({
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
