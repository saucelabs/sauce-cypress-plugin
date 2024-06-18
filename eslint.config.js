const ts = require('typescript-eslint');
const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const cypress = require('eslint-plugin-cypress/flat');
const jest = require('eslint-plugin-jest');

module.exports = ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    ignores: ['lib/**'],
  },
  {
    files: ['**/*.js', '**/*.ts'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-undef': 'warn',
    },
  },
  {
    files: ['tests/**/*.spec.js', 'tests/**/*.spec.ts'],
    ...jest.configs['flat/recommended'],
  },
  {
    files: ['tests/integration/cypress/**/*.js', 'tests/integration/cypress/**/*.ts'],
    ...cypress.configs.recommended,
  },
  {
    languageOptions: {
      globals: {
        __dirname: true,
        console: true,
        exports: true,
        module: true,
        require: true,
        process: true,
        NodeJS: true,
        Cypress: true,
        CypressCommandLine: true,
      },
    },
  },
);
