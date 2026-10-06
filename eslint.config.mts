import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
  // The recommended rules come without a file pattern; limit them to components, or they run on
  // package.json and TypeScript files whose parser has no Svelte context.
  ...svelte.configs.recommended.map((config) => (config.files || !config.rules ? config : { ...config, files: ['**/*.svelte', '**/*.svelte.ts'] })),
  {
    // Svelte components (src/ui): TypeScript in <script lang="ts">, checked against the same project.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: tseslint.parser,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The plugin-review rule against innerHTML, in Svelte form.
      'svelte/no-at-html-tags': 'error',
      // Styles live in styles.css with Obsidian's variables, never inline.
      'svelte/no-inline-styles': 'error',
      'svelte/require-each-key': 'error',
      'svelte/button-has-type': 'error',
    },
  },
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
      // Tests run in Node, where there is no window object.
      'obsidianmd/prefer-window-timers': 'off',
    },
  },
  {
    // Node-side tooling: the eval CLI and scripts may use fetch and Node built-ins.
    files: ['eval/**/*.ts', 'scripts/**/*.{ts,mjs,js}', '*.mjs', '*.mts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-globals': 'off',
      'import/no-extraneous-dependencies': 'off',
      // CLI tools report on stdout; the console rule targets plugin code.
      'obsidianmd/rule-custom-message': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      // Build tooling targets the dev vault, whose config folder is always .obsidian.
      'obsidianmd/hardcoded-config-path': 'off',
    },
  },
]);
