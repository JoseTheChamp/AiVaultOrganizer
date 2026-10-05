// Conventional Commits with the types and scopes defined in CLAUDE.md.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'style', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'core',
        'charter',
        'apply',
        'analysis',
        'embeddings',
        'ai',
        'planner',
        'drift',
        'ui',
        'obsidian',
        'eval',
        'release',
        'adr',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
