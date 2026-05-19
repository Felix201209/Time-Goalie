import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**", "server/data/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}", "*.js", "server/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^React$" }],
    },
  },
  {
    files: ["src/**/*.test.{js,jsx}", "server/**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
        ...globals.node,
      },
    },
  },
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs", "vite.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
        fetch: "readonly",
        structuredClone: "readonly",
      },
    },
  },
  {
    files: ["playwright.config.js", "vitest.config.js", "tests/e2e/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
      },
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        URL: "readonly",
      },
    },
  },
];
