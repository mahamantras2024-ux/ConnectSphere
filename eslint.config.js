const eslint = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/htmlcov/**',
      'artifacts/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx', '**/*.cjs'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-empty': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['backend/**/*.js', 'backend/**/*.cjs', 'scripts/**/*.cjs', 'tests/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
];
