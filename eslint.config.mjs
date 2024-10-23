import ts from "typescript-eslint";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import cypress from "eslint-plugin-cypress/flat";
import jest from "eslint-plugin-jest";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    ignores: ["lib/**"],
  },
  {
    files: ["**/*.js", "**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "warn",
    },
  },
  {
    files: ["tests/**/*.spec.js", "tests/**/*.spec.ts"],
    ...jest.configs["flat/recommended"],
  },
  {
    files: [
      "tests/integration/cypress/**/*.js",
      "tests/integration/cypress/**/*.ts",
    ],
    ...cypress.configs.recommended,
  },
  {
    ...cypress.configs.globals,
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
        CypressCommandLine: true,
      },
    },
  },
);
