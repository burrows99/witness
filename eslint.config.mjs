import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * What the type checker cannot say on its own.
 *
 * `tsc` proves the types line up. It does not notice a promise nobody awaited, a `catch` that swallows
 * a value it never looks at, or an export nothing imports — and this codebase is asynchronous almost
 * everywhere: a browser, a container, an HTTP call and a video encoder, all behind `await`. A floating
 * promise there is a step that silently did not happen, which is the one failure this tool exists to
 * make impossible.
 *
 * Type-aware, therefore. It costs a TypeScript build per run and finds things no syntactic linter can.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "**/artifacts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // The ones worth failing a build over, given what this does.
      // `node:test` returns a promise from `test()` that the RUNNER awaits. Told about it by name
      // rather than switched off in test files, so a genuinely floating promise there still fails.
      "@typescript-eslint/no-floating-promises": [
        "error",
        { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it", "before", "after", "beforeEach", "afterEach"] }] },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // A deliberately ignored error is this codebase's commonest idiom — the story must not fail the
      // run it is about — and every one of them carries a comment saying so.
      "@typescript-eslint/no-empty-function": "off",
      // Config is data of a shape the type system does not know until it is read.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // `_` for what a signature requires and the body does not use.
      // `const { a, b, ...rest } = x` is how this codebase drops keys; the named ones exist to be
      // left behind, which is not the same as being forgotten.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // A provider that satisfies an async interface without awaiting anything is not a mistake.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Plain JavaScript beside the sources: a banner script and this file. Linted, but not type-aware —
    // they are not in the TypeScript project and pretending otherwise only produces a parsing error.
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
  {
    // A test hands the real thing a fake, which is the point of it — and a fake is never the full type.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-empty-function": "off",
      // A fake's fields are `unknown` by construction; what they stringify to is the assertion.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
