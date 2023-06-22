module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  env: {
    node: true
  },
  root: true,
  ignorePatterns: [
    "/tests",
    "/src/**/*.js",
    "/src/**/*.d.ts"
  ],
  "rules": {
    // Due to js to ts conversion, a lot of rule exclusions are necessary for the time being. Can be removed once project is clean.
    "@typescript-eslint/ban-ts-comment": "warn"
  }
};
