import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    'node_modules/',
    'main.js',
    'dev-vault/',
    'coverage/',
    'eval/out/',
    'eval/reports/',
    'fixtures/',
  ]),
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Invariant 4: the core is pure TypeScript, runnable in Node (evals) and in Obsidian.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'obsidian', message: 'src/core must not import obsidian; add a port in src/core/ports.ts.' }],
          patterns: [
            { group: ['node:*'], message: 'src/core must not depend on Node built-ins; inject them through a port.' },
            { group: ['**/obsidian/**', '**/ui/**', '**/eval/**'], message: 'src/core must not import adapters or UI.' },
          ],
        },
      ],
    },
  },
  {
    // Tests build synthetic vaults that legitimately contain a `.obsidian` folder.
    files: ['**/*.test.ts'],
    rules: {
      'obsidianmd/hardcoded-config-path': 'off',
    },
  },
  {
    // Node-side tooling: the eval CLI and scripts may use fetch and Node built-ins.
    files: ['eval/**/*.ts', 'scripts/**/*.ts', '*.mjs', '*.mts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-globals': 'off',
      'import/no-extraneous-dependencies': 'off',
      // Build tooling targets the dev vault, whose config folder is always .obsidian.
      'obsidianmd/hardcoded-config-path': 'off',
    },
  },
]);
