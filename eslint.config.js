const ts = require('typescript-eslint');
const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const cypress = require('eslint-plugin-cypress');

module.exports = ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    plugins: { cypress: cypress },
  },
  {
    ignores: ['lib/**'],
  },
  {
    files: ['**/*.js', '**/*.ts'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'warn',
    },
  },
  {
    languageOptions: {
      globals: {
        __dirname: true,
        console: true,
        exports: true,
        module: true,
        require: true,
      },
    },
  },
);
