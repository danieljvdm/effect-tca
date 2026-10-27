import { defineConfig } from "vite-plus";
import type { OxfmtConfig } from "vite-plus/fmt";
import type { OxlintConfig } from "vite-plus/lint";

// Tool-owned paths that should not be linted or formatted. Skill copies remain
// tracked project inputs, while symlinked harness targets and generated Git
// hook internals may duplicate or contain third-party source. Keep these
// exclusions in tool configuration rather than `.gitignore`.
const toolIgnorePatterns = [
  ".agents/**",
  ".claude/**",
  ".opencode/**",
  ".vite-hooks/_/**",
  "**/worker-configuration.d.ts",
];

// Canonical formatting defaults for this project. Oxfmt does not support
// config inheritance, so this object is spread into the `fmt` block below.
const recommendedOxfmtConfig = {
  arrowParens: "always",
  endOfLine: "lf",
  ignorePatterns: toolIgnorePatterns,
  printWidth: 100,
  semi: true,
  singleQuote: false,
  sortImports: true,
  sortPackageJson: true,
  tabWidth: 2,
  trailingComma: "all",
  useTabs: false,
} satisfies OxfmtConfig;

// High-signal Oxlint defaults for this project, composed through `lint.extends`
// below so project-local plugins, rules, and overrides layer on top without
// losing this nested configuration.
const recommendedOxlintConfig = {
  ignorePatterns: toolIgnorePatterns,
  options: {
    typeAware: true,
  },
  jsPlugins: [
    // Oxlint's `extends` composition requires a package name or absolute path
    // for a JS plugin specifier — a relative path is only accepted at the
    // top-level `jsPlugins`, so these are resolved against this file.
    { name: "stylistic", specifier: new URL("./oxlint/plugin-style.js", import.meta.url).pathname },
  ],
  plugins: ["import", "react", "vitest"],
  rules: {
    eqeqeq: "error",
    "import/default": "off",
    "import/namespace": "off",
    "import/no-cycle": "error",
    "import/no-duplicates": ["error", { preferInline: true }],
    "import/no-self-import": "error",
    "react/exhaustive-deps": "error",
    "react/rules-of-hooks": "error",
    // Keep the severity with its options: a severity-only override discards this JS rule's options.
    "stylistic/padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: ["const", "let", "var", "multiline-export"], next: "*" },
      {
        blankLine: "always",
        prev: "*",
        next: ["multiline-const", "multiline-let", "multiline-var", "multiline-export"],
      },
      {
        blankLine: "any",
        prev: ["singleline-const", "singleline-let", "singleline-var"],
        next: ["singleline-const", "singleline-let", "singleline-var"],
      },
      { blankLine: "always", prev: "*", next: "return" },
    ],
    "typescript/consistent-type-imports": [
      "error",
      { fixStyle: "inline-type-imports", prefer: "type-imports" },
    ],
    "typescript/no-floating-promises": "off",
    "typescript/no-explicit-any": "error",
    "typescript/no-misused-spread": "off",
    "typescript/no-non-null-assertion": "error",
    "typescript/require-array-sort-compare": "off",
    "typescript/restrict-template-expressions": "off",
    "typescript/switch-exhaustiveness-check": "error",
    "unicorn/prefer-node-protocol": "error",
    "vitest/no-focused-tests": "error",
    "vitest/no-identical-title": "error",
    "vitest/no-standalone-expect": "off",
    "vitest/valid-expect": "error",
  },
  overrides: [
    {
      files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "typescript/no-non-null-assertion": "off",
      },
    },
  ],
} satisfies OxlintConfig;

export default defineConfig({
  staged: {
    "*.{js,cjs,mjs,ts,tsx}": "vp check --fix",
  },
  fmt: recommendedOxfmtConfig,
  lint: {
    extends: [recommendedOxlintConfig],
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    overrides: [
      {
        files: ["packages/tca/src/**/*.ts"],
        rules: {
          "import/no-nodejs-modules": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "node:*",
                    "bun",
                    "bun:*",
                    "@cloudflare/*",
                    "cloudflare:*",
                    "effect-cf",
                    "effect-cf/*",
                    "alchemy",
                    "alchemy/*",
                    "@alchemy.run/*",
                    "expo-*",
                    "@effect/platform-*",
                    "effect-tca-*",
                  ],
                  message: "Keep platform dependencies in adapters.",
                },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    cache: false,
    silent: "passed-only",
  },
  run: {
    cache: { scripts: true },
    tasks: {
      changeset: {
        cache: false,
        command: "changeset",
      },
      "changeset:pre": {
        cache: false,
        command: "changeset pre",
      },
      "changeset:version": {
        cache: false,
        command: "changeset version",
      },
      "ci:format": {
        command: "vp fmt --check",
      },
      "release:check": {
        // Recreate the tarballs and verify a clean install, including registry mode.
        cache: false,
        command: "node scripts/release-check.mjs",
      },
      "release:version": {
        cache: false,
        // PRs created with GITHUB_TOKEN do not trigger pull_request CI.
        command: "vp run changeset:version && vp install && vp run ready",
      },
      "release:plan": {
        cache: false,
        command: "node scripts/release-publish.mjs --plan-only",
      },
      "release:publish": {
        cache: false,
        command: "node scripts/release-publish.mjs",
      },
    },
  },
});
